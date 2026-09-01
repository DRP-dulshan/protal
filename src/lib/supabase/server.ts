import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/db/database.types";
import { env } from "@/lib/env";

/**
 * Request-scoped Supabase client. Every query made through this client runs as
 * the signed-in user, so Row Level Security is what actually enforces access -
 * not the code around it.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only ever use this for background work that acts on behalf of the system
 * itself - compliance alert sweeps, scheduled statement runs, webhook intake.
 * Never use it to serve a user request: that would silently discard every
 * access rule in 0010_rls.sql.
 */
export function createAdminClient() {
  if (!env.supabaseServiceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured; admin client unavailable"
    );
  }

  return createServerClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    cookies: { getAll: () => [], setAll: () => {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
