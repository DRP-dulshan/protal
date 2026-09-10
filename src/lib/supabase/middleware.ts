import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/db/database.types";

/** Refresh this many seconds before the access token actually expires. */
const REFRESH_MARGIN_SECONDS = 120;

/**
 * Reads the access token's expiry from the session cookie without a network
 * call and without verifying the signature.
 *
 * This is only ever used to decide *whether a refresh is due*. It is never an
 * authorisation decision: PostgREST verifies the signature on every query, and
 * RLS decides what the row set is. A forged or tampered cookie gets past this
 * check and then receives nothing from the database - `current_profile()`
 * returns no row and the page redirects to the login screen.
 *
 * Returns null when the cookie is absent or unparseable, which callers treat
 * as "refresh needed".
 */
function accessTokenExpiry(request: NextRequest): number | null {
  const cookie = request.cookies
    .getAll()
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    // Large sessions are split across .0, .1 … chunks that must be rejoined.
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => c.value)
    .join("");

  if (!cookie) return null;

  try {
    const raw = cookie.startsWith("base64-")
      ? Buffer.from(cookie.slice("base64-".length), "base64").toString("utf8")
      : decodeURIComponent(cookie);

    const session = JSON.parse(raw) as { access_token?: string };
    const token = session.access_token;
    if (!token) return null;

    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8")
    ) as { exp?: number };

    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/**
 * Refreshes the Supabase session cookie when it is close to expiring, and gates
 * the authenticated surface.
 *
 * `auth.getUser()` costs a full round trip to Supabase. Doing it on every
 * request added ~100 ms to every page for no benefit while the token was still
 * valid, so it now runs only when a refresh is actually due.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without configuration there is no session to refresh. Let the request
  // through so the setup screen can explain what is missing.
  if (!url || !key) return response;

  const path = request.nextUrl.pathname;
  const isPublic =
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/setup") ||
    // Scheduled jobs carry no session; they authenticate with CRON_SECRET.
    path.startsWith("/api/keep-alive") ||
    path === "/";

  const exp = accessTokenExpiry(request);
  const now = Math.floor(Date.now() / 1000);
  const hasLiveToken = exp !== null && exp - now > REFRESH_MARGIN_SECONDS;

  if (!hasLiveToken) {
    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user && !isPublic) {
      const redirect = request.nextUrl.clone();
      redirect.pathname = "/login";
      redirect.searchParams.set("next", path);
      return NextResponse.redirect(redirect);
    }
  }

  return response;
}
