import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * Keeps the Supabase project from being paused.
 *
 * Supabase pauses a free-tier project after roughly a week without activity,
 * and a paused project stops resolving in DNS entirely - the app goes down
 * rather than degrading. That is fine for a dormant side project and not fine
 * for a demo someone has been given a link to.
 *
 * A trivial daily query is enough to count as activity. Once the project is on
 * a paid plan this route can be deleted along with its cron entry.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // Vercel signs cron invocations with CRON_SECRET when it is configured.
  // Reject anything else so the endpoint cannot be used to probe the backend.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
  }

  try {
    const supabase = createAdminClient();
    const { error } = await supabase
      .from("company_settings")
      .select("id")
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true, checkedAt: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "unknown" },
      { status: 503 }
    );
  }
}
