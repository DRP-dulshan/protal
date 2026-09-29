import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { syncAllUnits } from "@/lib/ical/sync";
import { sendQueuedEmails } from "@/lib/notify/email";
import { env } from "@/lib/env";

/**
 * Airbnb calendar import for every unit with a feed link. Called every 15
 * minutes by Supabase pg_cron (see supabase/cron/ical_sync.sql) - Vercel's
 * Hobby plan only allows daily crons.
 *
 * Authenticated by CRON_SECRET, and refuses to run at all without one: this
 * endpoint writes bookings with the service key.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(request: NextRequest) {
  if (!env.cronSecret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (!authorised(request)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const started = Date.now();
  try {
    const client = createAdminClient();
    const results = await syncAllUnits(client);
    // New imports queue booking emails; send them, plus anything a staff
    // action queued that was not sent at the time.
    const emails = await sendQueuedEmails(client);
    const failed = results.filter((r) => !r.ok);
    return NextResponse.json({
      ok: failed.length === 0,
      units: results.length,
      failed: failed.length,
      created: results.reduce((n, r) => n + (r.created ?? 0), 0),
      cancelled: results.reduce((n, r) => n + (r.cancelled ?? 0), 0),
      emails,
      ms: Date.now() - started,
      errors: failed.map((r) => ({ unitId: r.unitId, errors: r.errors.slice(0, 3) })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 500 }
    );
  }
}

export const GET = handle;
export const POST = handle;
