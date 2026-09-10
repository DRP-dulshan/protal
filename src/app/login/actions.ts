"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { homePathForRole, type Role } from "@/lib/auth/rbac";

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) redirect("/login?error=missing");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Distinguish "we could not reach the backend" from "wrong password".
    // Supabase pauses idle free-tier projects, and when that happens the host
    // stops resolving - reporting it as a bad password sends the user off
    // retyping credentials that were never wrong.
    const unreachable =
      error.status === undefined ||
      error.status === 0 ||
      error.status >= 500 ||
      /fetch failed|network|ENOTFOUND|EAI_AGAIN|timeout/i.test(error.message);

    redirect(`/login?error=${unreachable ? "unavailable" : "invalid"}`);
  }

  if (!data.user) redirect("/login?error=invalid");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .single();

  if (profile && !profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=account_disabled");
  }

  // Record the sign-in; a failure here must not block the user getting in.
  await supabase
    .from("profiles")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", data.user.id);

  revalidatePath("/", "layout");
  redirect(next && next.startsWith("/") ? next : homePathForRole(profile?.role as Role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
