import { Sidebar } from "@/components/layout/sidebar";
import { OWNER_NAV } from "@/components/layout/nav";
import { requirePortalProfile } from "@/lib/auth/session";
import { signOut } from "@/app/login/actions";

/**
 * Owner portal shell, served on the owner host only. Staff sessions never
 * reach it: staff cannot sign in on this host, and any other session found
 * here is signed out. The tenant and guest portals are disabled.
 */
export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requirePortalProfile("owner");

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        sections={OWNER_NAV}
        role={profile.role}
        userName={profile.full_name || profile.email || "User"}
        signOutAction={signOut}
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
