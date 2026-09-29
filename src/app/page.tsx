import { notFound, redirect } from "next/navigation";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth/session";
import { portalHome, roleAllowedOnPortal } from "@/lib/portal";
import { currentPortal, WRONG_PORTAL_PATH } from "@/lib/portal-server";

/** Front door: each host sends its own users to its own landing page. */
export default async function Home() {
  const portal = await currentPortal();
  if (!portal) notFound();
  if (!isConfigured) redirect(portal === "admin" ? "/setup" : "/login");

  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(roleAllowedOnPortal(profile.role, portal) ? portalHome(portal) : WRONG_PORTAL_PATH);
}
