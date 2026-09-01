"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as Icons from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { can, ROLE_LABELS, type Role } from "@/lib/auth/rbac";
import type { NavSection } from "./nav";

function Icon({ name, className }: { name: string; className?: string }) {
  const Component = (Icons as unknown as Record<string, React.ComponentType<{ className?: string }>>)[
    name
  ];
  return Component ? <Component className={className} /> : null;
}

export function Sidebar({
  sections,
  role,
  userName,
  signOutAction,
}: {
  sections: NavSection[];
  role: Role;
  userName: string;
  signOutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = React.useState(false);

  // Close the drawer whenever the route changes on mobile.
  React.useEffect(() => setOpen(false), [pathname]);

  const visible = sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => can(role, item.capability)),
    }))
    .filter((section) => section.items.length > 0);

  const isActive = (href: string) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  const nav = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[var(--primary)]">
          <Icons.Building2 className="size-4.5 text-[var(--primary-foreground)]" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            D<span className="text-[var(--brand)]">|</span>R
            <span className="text-[var(--brand)]">|</span>P
          </p>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
            Property Management
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {visible.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              {section.label}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                      isActive(item.href)
                        ? "bg-[var(--primary)] font-medium text-[var(--primary-foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
                    )}
                  >
                    <Icon name={item.icon} className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-[var(--border)] p-3">
        <div className="mb-2 min-w-0 px-1">
          <p className="truncate text-sm font-medium">{userName}</p>
          <p className="truncate text-xs text-[var(--muted-foreground)]">
            {ROLE_LABELS[role]}
          </p>
        </div>
        <form action={signOutAction}>
          <Button
            type="submit"
            variant="ghost"
            size="sm"
            className="w-full justify-start text-[var(--muted-foreground)]"
          >
            <Icons.LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </div>
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--card)] px-3 py-2 lg:hidden">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
        >
          <Icons.Menu className="size-5" />
        </Button>
        <span className="text-sm font-semibold">
          D<span className="text-[var(--brand)]">|</span>R
          <span className="text-[var(--brand)]">|</span>P
        </span>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 border-r border-[var(--border)] bg-[var(--card)] transition-transform lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {nav}
      </aside>
    </>
  );
}
