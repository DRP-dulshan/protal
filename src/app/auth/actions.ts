"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/session";
import { portalHome, roleAllowedOnPortal } from "@/lib/portal";
import { currentPortal, WRONG_PORTAL_PATH } from "@/lib/portal-server";

const LINK_TYPES = new Set(["invite", "recovery"]);

/**
 * Spends a one-time sign-in link and opens a session. Runs only when the owner
 * presses Continue - never on a plain GET - so a link preview in WhatsApp or a
 * mail scanner cannot use the token up before the owner does.
 */
export async function confirmLink(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "");
  // Errors stay on /auth/confirm: /login forwards anyone already signed in
  // to their portal, which would hide the message.
  if (!tokenHash || !LINK_TYPES.has(type)) redirect("/auth/confirm?error=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as "invite" | "recovery",
  });
  if (error) {
    console.error(`[auth] sign-in link refused: ${error.code ?? error.status ?? "unknown"} ${error.message}`);
    redirect("/auth/confirm?error=link_invalid");
  }

  redirect("/auth/set-password");
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) redirect("/auth/set-password?error=short");
  if (password !== confirm) redirect("/auth/set-password?error=mismatch");

  const profile = await getProfile();
  if (!profile) redirect("/login?error=link_invalid");

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(
      `/auth/set-password?error=${error.code === "same_password" ? "same" : "failed"}`
    );
  }

  await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", profile.id);

  const portal = await currentPortal();
  revalidatePath("/", "layout");
  redirect(
    portal && roleAllowedOnPortal(profile.role, portal) ? portalHome(portal) : WRONG_PORTAL_PATH
  );
}
