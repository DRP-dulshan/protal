import { redirect } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { STAFF_NAV } from "@/components/layout/nav";
import { requireProfile } from "@/lib/auth/session";
import { isStaff, homePathForRole } from "@/lib/auth/rbac";
import { signOut } from "@/app/login/actions";

/**
 * Back-office shell. Portal users who land here are bounced to their own
 * surface rather than shown an empty admin screen.
 */
export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  if (!isStaff(profile.role)) redirect(homePathForRole(profile.role));

  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <Sidebar
        sections={STAFF_NAV}
        role={profile.role}
        userName={profile.full_name || profile.email || "User"}
        signOutAction={signOut}
      />
      <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
