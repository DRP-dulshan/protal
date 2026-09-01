import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { OWNER_NAV, TENANT_NAV, GUEST_NAV } from "@/components/layout/nav";
import { requireProfile } from "@/lib/auth/session";
import { homePathForRole, isStaff } from "@/lib/auth/rbac";
import { signOut } from "@/app/login/actions";

/**
 * Portal shell for owners, tenants and guests. Staff are redirected to the
 * back office so nobody works out of the wrong surface by accident.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  if (isStaff(profile.role)) redirect(homePathForRole(profile.role));

  const sections =
    profile.role === "owner"
      ? OWNER_NAV
      : profile.role === "guest"
        ? GUEST_NAV
        : TENANT_NAV;

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        sections={sections}
        role={profile.role}
        userName={profile.full_name || profile.email || "User"}
        signOutAction={signOut}
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
