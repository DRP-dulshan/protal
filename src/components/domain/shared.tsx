import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { formatAED } from "@/lib/money";

/** Standard page heading with optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  breadcrumb?: { label: string; href?: string }[];
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-1 flex flex-wrap items-center gap-1 text-xs text-[var(--muted-foreground)]">
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={`${crumb.label}-${i}`}>
                {i > 0 && <span aria-hidden>/</span>}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-[var(--foreground)]">
                    {crumb.label}
                  </Link>
                ) : (
                  <span>{crumb.label}</span>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Headline metric tile used across the dashboards. */
export function StatCard({
  label,
  value,
  sublabel,
  icon,
  tone = "default",
  href,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
  icon?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "brand";
  href?: string;
}) {
  const toneRing: Record<string, string> = {
    default: "",
    success: "border-l-4 border-l-[var(--success)]",
    warning: "border-l-4 border-l-[var(--warning)]",
    danger: "border-l-4 border-l-[var(--destructive)]",
    brand: "border-l-4 border-l-[var(--brand)]",
  };

  const body = (
    <Card className={cn("h-full transition-shadow", toneRing[tone], href && "hover:shadow-md")}>
      <CardContent className="flex items-start justify-between gap-3 p-3 sm:p-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)] sm:text-xs">
            {label}
          </p>
          {/* Wraps rather than cuts off: a figure is no use as "AED 58,…". */}
          <p className="tabular mt-1.5 break-words text-xl font-semibold leading-tight sm:text-2xl">
            {value}
          </p>
          {sublabel && (
            <p className="mt-1 text-xs leading-snug text-[var(--muted-foreground)]">{sublabel}</p>
          )}
        </div>
        {/* On a phone the two-up cards need every pixel for the figure. */}
        {icon && <div className="hidden shrink-0 text-[var(--muted-foreground)] sm:block">{icon}</div>}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Money, right-aligned with tabular figures so columns line up. */
export function Money({
  amount,
  className,
  compact,
  muted,
}: {
  amount: number | string | null | undefined;
  className?: string;
  compact?: boolean;
  muted?: boolean;
}) {
  return (
    <span
      className={cn(
        "tabular whitespace-nowrap",
        muted && "text-[var(--muted-foreground)]",
        className
      )}
    >
      {formatAED(amount, { compact })}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] px-6 py-12 text-center">
      {icon && <div className="mb-3 text-[var(--muted-foreground)]">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm text-[var(--muted-foreground)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label/value pair used on every detail page. */
export function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-0.5 truncate text-sm">{children ?? "—"}</dd>
    </div>
  );
}

export function FieldGrid({
  children,
  columns = 3,
}: {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
}) {
  const cols = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
  }[columns];

  return <dl className={cn("grid grid-cols-1 gap-4", cols)}>{children}</dl>;
}

/** Inline banner for warnings that need to be read, not dismissed. */
export function Callout({
  tone = "warning",
  title,
  children,
}: {
  tone?: "warning" | "danger" | "info";
  title: string;
  children?: React.ReactNode;
}) {
  const tones = {
    warning:
      "border-[var(--warning)]/40 bg-[var(--warning)]/10 text-[var(--foreground)]",
    danger:
      "border-[var(--destructive)]/40 bg-[var(--destructive)]/10 text-[var(--foreground)]",
    info: "border-[var(--border)] bg-[var(--muted)] text-[var(--foreground)]",
  };

  return (
    <div className={cn("rounded-lg border p-3 text-sm", tones[tone])}>
      <p className="font-medium">{title}</p>
      {children && (
        <div className="mt-1 text-[var(--muted-foreground)]">{children}</div>
      )}
    </div>
  );
}
