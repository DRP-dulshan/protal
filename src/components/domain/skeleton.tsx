import { cn } from "@/lib/utils";

/**
 * Loading placeholders.
 *
 * These exist so a navigation paints immediately instead of leaving the last
 * page frozen while the server fetches. The shapes deliberately mirror the
 * real layout - a skeleton that matches what arrives reads as fast, one that
 * does not reads as a flash of the wrong thing.
 */
function Shimmer({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-[var(--muted)]", className)}
      aria-hidden
    />
  );
}

export function PageHeaderSkeleton() {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-2">
        <Shimmer className="h-7 w-56" />
        <Shimmer className="h-4 w-80" />
      </div>
      <div className="flex gap-2">
        <Shimmer className="h-9 w-28" />
        <Shimmer className="h-9 w-24" />
      </div>
    </div>
  );
}

export function StatCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
        >
          <Shimmer className="h-3 w-24" />
          <Shimmer className="mt-2.5 h-7 w-20" />
          <Shimmer className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-3 py-3">
        <Shimmer className="h-3 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 border-b border-[var(--border)] px-3 py-3.5 last:border-0"
        >
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-4 w-48" />
            <Shimmer className="h-3 w-32" />
          </div>
          <Shimmer className="hidden h-4 w-28 md:block" />
          <Shimmer className="h-5 w-20" />
          <Shimmer className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/** The shape most list pages share: header, filter bar, table. */
export function ListPageSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <>
      <PageHeaderSkeleton />
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <Shimmer className="h-9 w-full" />
      </div>
      <TableSkeleton rows={rows} />
    </>
  );
}
