import { redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/rbac";

/** Front door: send each role to the surface it actually works in. */
export default async function Home() {
  if (!isConfigured) redirect("/setup");

  const profile = await getProfile();
  redirect(profile ? homePathForRole(profile.role) : "/login");
}
