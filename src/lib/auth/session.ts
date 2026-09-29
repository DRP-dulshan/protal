import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import type { Tables } from "@/lib/db/database.types";
import { can, homePathForRole, type Capability, type Role } from "./rbac";
import { roleAllowedOnPortal, type Portal } from "@/lib/portal";
import { currentPortal, WRONG_PORTAL_PATH } from "@/lib/portal-server";

export type Profile = Tables<"profiles">;

/**
 * Set once if current_profile() turns out not to exist, so a database that has
 * not had migration 0013 applied pays the discovery cost a single time per
 * process rather than a wasted round trip on every request.
 */
let currentProfileRpcMissing = false;

/**
 * The signed-in user's profile, memoised per request so a page and its nested
 * layouts share one round trip.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  // Without credentials there is no session to read. Returning null here sends
  // the caller down the redirect path instead of throwing from deep inside a
  // page render.
  if (!isConfigured) return null;

  const supabase = await createClient();

  // One round trip rather than getUser() + a select on profiles. PostgREST
  // verifies the JWT signature before current_profile() runs, so auth.uid()
  // inside it is as trustworthy as it is in any RLS policy - and the middleware
  // has already refreshed the session for this request.
  if (!currentProfileRpcMissing) {
    const { data, error } = await supabase.rpc("current_profile");

    if (!error) {
      // A composite-returning RPC yields the row itself, or null when the
      // session is invalid or the account has been deactivated.
      const profile = data as unknown as Profile | null;
      return profile && profile.id ? profile : null;
    }

    // PGRST202 = the function is not in the schema cache, i.e. migration 0013
    // has not been applied. Anything else is a genuine failure worth surfacing.
    if (error.code !== "PGRST202") return null;

    currentProfileRpcMissing = true;
    console.warn(
      "[auth] current_profile() not found - apply supabase/migrations/" +
        "0013_current_profile.sql to remove an extra round trip per request."
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: row } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return row ?? null;
});

/** Redirects to the login screen when there is no active session. */
export async function requireProfile(): Promise<Profile> {
  if (!isConfigured) redirect("/setup");

  const profile = await getProfile();
  if (!profile) redirect("/login");
  if (!profile.is_active) redirect("/login?error=account_disabled");
  return profile;
}

/**
 * The profile of a user who belongs on this portal. A session that exists but
 * is on the wrong host - an owner on admin., a staff login on owner. - is
 * signed out rather than shown anything, and so is a request that reached a
 * portal layout on a host that is not that portal.
 */
export async function requirePortalProfile(portal: Portal): Promise<Profile> {
  const profile = await requireProfile();
  if ((await currentPortal()) !== portal || !roleAllowedOnPortal(profile.role, portal)) {
    redirect(WRONG_PORTAL_PATH);
  }
  return profile;
}

/**
 * Gate a route on a capability. Sends the user to their own home rather than a
 * dead end, so a tenant following a stale admin link lands somewhere useful.
 */
export async function requireCapability(capability: Capability): Promise<Profile> {
  const profile = await requireProfile();
  if (!can(profile.role, capability)) {
    redirect(homePathForRole(profile.role));
  }
  return profile;
}

export async function requireRole(roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) {
    redirect(homePathForRole(profile.role));
  }
  return profile;
}

export interface PortalSettings {
  trade_name: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  brand_primary_hex: string;
  brand_accent_hex: string;
  maintenance_owner_approval_threshold: number;
  show_guest_first_name_to_owners: boolean;
}

/**
 * The slice of company settings a portal user may see. Owners cannot read
 * company_settings itself (it holds commission rates); portal_settings()
 * returns only these columns.
 */
export const getPortalSettings = cache(async (): Promise<PortalSettings | null> => {
  if (!isConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_settings");
  const rows = data as unknown as PortalSettings[] | null;
  return rows?.[0] ?? null;
});

/**
 * Company-wide settings (VAT rate, fee defaults, branding, notice periods).
 * Staff only - RLS returns nothing to portal users; use getPortalSettings().
 */
export const getCompanySettings = cache(async () => {
  if (!isConfigured) return null;

  const supabase = await createClient();
  const { data } = await supabase.from("company_settings").select("*").single();
  return data;
});
