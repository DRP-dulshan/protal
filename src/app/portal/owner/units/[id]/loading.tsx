import { CalendarSkeleton, PageHeaderSkeleton, TableSkeleton } from "@/components/domain/skeleton";

export default function Loading() {
  return (
    <>
      <PageHeaderSkeleton />
      <CalendarSkeleton />
      <div className="mt-6">
        <TableSkeleton rows={4} />
      </div>
    </>
  );
}
