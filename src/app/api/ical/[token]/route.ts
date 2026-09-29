import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildICal, type ExportEvent } from "@/lib/ical/build";

/**
 * GET /api/ical/<token>.ics - a unit's blocked dates, for Airbnb to import.
 *
 * Lists confirmed bookings from every channel except Airbnb (exporting
 * Airbnb's own stays back to it would loop) plus manual blocks - owner stays,
 * maintenance and the like. Dates only: no guest names, no prices.
 *
 * The token is the only credential, so it is long (64 hex characters), the
 * response for a wrong token is a plain 404, and it can be regenerated from
 * the unit page if it ever leaks.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = raw.replace(/\.ics$/i, "");
  if (!/^[0-9a-f]{64}$/.test(token)) return new NextResponse("Not found", { status: 404 });

  // A system endpoint acting for Airbnb, not for a signed-in user, so it uses
  // the service client; the token match below is the whole access check.
  const supabase = createAdminClient();
  const [unitResult, eventsResult] = await Promise.all([
    supabase
      .from("units")
      .select("unit_number, properties(name)")
      .eq("ical_export_token", token)
      .eq("is_active", true)
      .maybeSingle(),
    supabase.rpc("ical_export_events", { p_token: token }),
  ]);

  if (unitResult.error || eventsResult.error) {
    return new NextResponse("Calendar temporarily unavailable", { status: 503 });
  }
  const unit = unitResult.data;
  if (!unit) return new NextResponse("Not found", { status: 404 });

  const rows = (eventsResult.data ?? []) as unknown as {
    uid: string;
    start_date: string;
    end_date: string;
    kind: string;
  }[];
  const events: ExportEvent[] = rows.map((r) => ({
    uid: r.uid,
    start: r.start_date,
    end: r.end_date,
    kind: r.kind,
  }));

  const body = buildICal({
    name: `DRP ${unit.properties?.name ?? ""} ${unit.unit_number}`.replace(/\s+/g, " ").trim(),
    events,
  });

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `inline; filename="drp-${unit.unit_number}.ics"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
