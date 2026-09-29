"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can, isStaff } from "@/lib/auth/rbac";
import { env } from "@/lib/env";
import { toE164 } from "@/lib/messaging";

export type PortalAccessState = {
  error?: string;
  /** One-time link the owner opens to set their password. */
  link?: string;
  email?: string;
  whatsappUrl?: string;
  mailtoUrl?: string;
};

const grantSchema = z.object({
  ownerId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
});

/**
 * Gives an owner a login to the owner portal and returns a one-time link for
 * them to set their password.
 *
 * Nothing is emailed from here: Supabase's built-in mailer only delivers to the
 * project's own team, so the link is handed back for staff to send on WhatsApp
 * or email themselves - which is how the office talks to owners anyway.
 *
 * The service key is used for one thing only, creating the auth user and its
 * link, which no user session can do. The role change and the owner link go
 * through the caller's own session, so RLS (super admin only) still decides
 * whether they are allowed.
 */
export async function grantPortalAccess(
  _prev: PortalAccessState,
  formData: FormData
): Promise<PortalAccessState> {
  const profile = await requireProfile();
  if (!can(profile.role, "users.manage")) {
    return { error: "Only a super admin can give portal access." };
  }
  if (!env.supabaseServiceRoleKey) {
    return {
      error:
        "SUPABASE_SECRET_KEY is not set in .env.local, so logins cannot be created. " +
        "Add it from Supabase -> Project Settings -> API Keys and restart the app.",
    };
  }

  const parsed = grantSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const { ownerId, email } = parsed.data;

  const supabase = await createClient();

  const { data: owner } = await supabase
    .from("owners")
    .select("id, full_name, phone, whatsapp")
    .eq("id", ownerId)
    .maybeSingle();
  if (!owner) return { error: "Owner not found." };

  // Never turn a staff account into an owner login.
  const { data: existing } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("email", email)
    .maybeSingle();
  if (existing && isStaff(existing.role)) {
    return {
      error: "That email belongs to a D|R|P staff account. Use the owner's own email address.",
    };
  }

  // A new address gets an invite link; one that already has a login gets a
  // password-reset link instead, which signs them in the same way.
  const admin = createAdminClient();
  let result = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: owner.full_name } },
  });
  let linkType: "invite" | "recovery" = "invite";
  if (result.error && (result.error.code === "email_exists" || result.error.status === 422)) {
    result = await admin.auth.admin.generateLink({ type: "recovery", email });
    linkType = "recovery";
  }
  if (result.error || !result.data.user) {
    return { error: `Could not create the login: ${result.error?.message ?? "unknown error"}` };
  }

  const userId = result.data.user.id;

  const { error: profileError } = await supabase.from("profiles").upsert(
    {
      id: userId,
      email,
      full_name: owner.full_name,
      phone: owner.phone,
      role: "owner",
      is_active: true,
    },
    { onConflict: "id" }
  );
  if (profileError) return { error: `Could not set the owner role: ${profileError.message}` };

  const { error: linkError } = await supabase
    .from("owner_users")
    .upsert(
      { owner_id: owner.id, profile_id: userId },
      { onConflict: "owner_id,profile_id", ignoreDuplicates: true }
    );
  if (linkError) return { error: `Could not link the login: ${linkError.message}` };

  // Opening the link shows a Continue button; the token is only spent on that
  // click, so a WhatsApp or email link preview cannot use it up.
  const link = `${env.ownerUrl}/auth/confirm?${new URLSearchParams({
    token_hash: result.data.properties.hashed_token,
    type: linkType,
  })}`;

  const message =
    `Hello ${owner.full_name}, your D|R|P owner portal is ready. ` +
    `Open this link to set your password: ${link}\n\n` +
    `The link works once and expires after a short time. ` +
    `After that, sign in at ${env.ownerUrl} with ${email}.`;

  const phone = owner.whatsapp ?? owner.phone;

  revalidatePath(`/owners/${owner.id}`);
  return {
    link,
    email,
    whatsappUrl: phone
      ? `https://wa.me/${toE164(phone).replace("+", "")}?text=${encodeURIComponent(message)}`
      : undefined,
    mailtoUrl: `mailto:${email}?subject=${encodeURIComponent(
      "Your D|R|P owner portal login"
    )}&body=${encodeURIComponent(message)}`,
  };
}

const revokeSchema = z.object({
  ownerId: z.string().uuid(),
  profileId: z.string().uuid(),
});

/**
 * Removes a login from an owner. When the login is linked to no other owner
 * it loses the owner role, so the next request it makes is signed out.
 */
export async function revokePortalAccess(formData: FormData): Promise<void> {
  const profile = await requireProfile();
  if (!can(profile.role, "users.manage")) return;

  const parsed = revokeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const { ownerId, profileId } = parsed.data;

  const supabase = await createClient();
  await supabase
    .from("owner_users")
    .delete()
    .eq("owner_id", ownerId)
    .eq("profile_id", profileId);

  const { count } = await supabase
    .from("owner_users")
    .select("owner_id", { count: "exact", head: true })
    .eq("profile_id", profileId);

  if (!count) {
    await supabase
      .from("profiles")
      .update({ role: "guest" })
      .eq("id", profileId)
      .eq("role", "owner");
  }

  revalidatePath(`/owners/${ownerId}`);
}
