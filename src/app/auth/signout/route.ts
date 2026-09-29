import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

/** Reasons the login screen knows how to explain. Anything else is dropped. */
const REASONS = new Set(["wrong_portal", "no_access", "account_disabled"]);

/**
 * Ends the session and returns to the login screen.
 *
 * Server Components cannot write cookies, so a layout that finds a session on
 * the wrong portal (an owner on the admin host, say) redirects here rather
 * than signing out itself.
 */
async function handle(request: NextRequest) {
  if (isConfigured) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }

  const reason = request.nextUrl.searchParams.get("reason");
  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = reason && REASONS.has(reason) ? `?error=${reason}` : "";
  return NextResponse.redirect(target, { status: 303 });
}

export const GET = handle;
export const POST = handle;
