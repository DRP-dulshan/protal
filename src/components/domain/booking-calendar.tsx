import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { coversNight, dubaiToday, monthGrid, nightsBetween, shiftMonth } from "@/lib/calendar";
import { formatMonth } from "@/lib/dates";
import { SALES_CHANNEL } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

export interface CalendarStay {
  id: string;
  checkIn: string;
  checkOut: string;
  source: Enums<"sales_channel">;
  /** Optional detail for the tooltip, e.g. guest first name. */
  label?: string | null;
  /** Unconfirmed requests are drawn outlined rather than filled (admin only). */
  pending?: boolean;
  href?: string;
}

export interface CalendarBlock {
  id: string;
  start: string;
  end: string;
  reason: Enums<"block_reason">;
}

const BLOCK_LABEL: Record<Enums<"block_reason">, string> = {
  booking: "Booked",
  maintenance: "Maintenance",
  owner_stay: "Owner stay",
  housekeeping: "Housekeeping",
  blocked: "Blocked",
  channel_sync: "Blocked on Airbnb",
};

const sourceTone = (source: Enums<"sales_channel">) =>
  source === "airbnb"
    ? "bg-rose-500/15 text-rose-800 dark:text-rose-200 border-rose-500/50"
    : source === "direct"
      ? "bg-[var(--brand)]/25 text-[var(--brand-foreground)] dark:text-[var(--brand)] border-[var(--brand)]"
      : "bg-sky-500/15 text-sky-800 dark:text-sky-200 border-sky-500/50";

const BLOCK_TONE =
  "text-[var(--muted-foreground)] bg-[repeating-linear-gradient(135deg,var(--muted),var(--muted)_6px,transparent_6px,transparent_12px)]";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month view of a single unit's calendar. Server-rendered; month navigation is
 * plain links so it works without JavaScript and each month is shareable.
 *
 * It renders whatever it is given and never fetches: the caller decides what
 * the viewer may see (owners pass rows from owner_bookings_view, which has no
 * money in it to begin with).
 */
export function BookingCalendar({
  month,
  stays,
  blocks = [],
  monthHref,
}: {
  month: string;
  stays: CalendarStay[];
  blocks?: CalendarBlock[];
  monthHref: (month: string) => string;
}) {
  const weeks = monthGrid(month);
  const today = dubaiToday();

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{formatMonth(`${month}-01`)}</h3>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm" aria-label="Previous month">
            <Link href={monthHref(shiftMonth(month, -1))} scroll={false}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={monthHref(today.slice(0, 7))} scroll={false}>
              Today
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" aria-label="Next month">
            <Link href={monthHref(shiftMonth(month, 1))} scroll={false}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--muted)]">
          {WEEKDAYS.map((d) => (
            <div
              key={d}
              className="px-1.5 py-1.5 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]"
            >
              {d}
            </div>
          ))}
        </div>

        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-[var(--border)] last:border-b-0">
            {week.map((day, i) => {
              const inMonth = day.startsWith(month);
              const stay = stays.find((s) => coversNight(day, s.checkIn, s.checkOut));
              const block = stay ? undefined : blocks.find((b) => coversNight(day, b.start, b.end));
              const checkout = stays.find((s) => s.checkOut === day);
              const isStart = stay && (stay.checkIn === day || i === 0);
              const title = stay
                ? `${SALES_CHANNEL[stay.source]}${stay.pending ? " (pending)" : ""} · ` +
                  `${stay.checkIn} → ${stay.checkOut} · ${nightsBetween(stay.checkIn, stay.checkOut)} nights` +
                  (stay.label ? ` · ${stay.label}` : "")
                : block
                  ? `${BLOCK_LABEL[block.reason]} · ${block.start} → ${block.end}`
                  : undefined;

              const cell = (
                <div
                  title={title}
                  className={cn("relative h-full min-h-16 p-1 sm:min-h-20", !inMonth && "bg-[var(--muted)]/40")}
                >
                  <span
                    className={cn(
                      "tabular inline-flex size-6 items-center justify-center rounded-full text-xs",
                      !inMonth && "text-[var(--muted-foreground)]/60",
                      day === today && "bg-[var(--primary)] font-semibold text-[var(--primary-foreground)]"
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>

                  {checkout && !stay && (
                    <span className="absolute right-1 top-1.5 text-[10px] text-[var(--muted-foreground)]">
                      check-out
                    </span>
                  )}

                  {stay && (
                    <div
                      className={cn(
                        "mt-1 truncate rounded px-1 py-0.5 text-[10px] font-medium leading-tight sm:text-[11px]",
                        stay.pending ? "border border-dashed" : "border-l-2",
                        sourceTone(stay.source),
                        stay.pending && "bg-transparent"
                      )}
                    >
                      {isStart ? (
                        <>
                          {SALES_CHANNEL[stay.source]}
                          <span className="hidden sm:inline">
                            {" "}· {nightsBetween(stay.checkIn, stay.checkOut)}n
                          </span>
                        </>
                      ) : (
                        <span aria-hidden>&nbsp;</span>
                      )}
                    </div>
                  )}

                  {block && (
                    <div className={cn("mt-1 truncate rounded px-1 py-0.5 text-[10px] font-medium sm:text-[11px]", BLOCK_TONE)}>
                      {block.start === day || i === 0 ? BLOCK_LABEL[block.reason] : " "}
                    </div>
                  )}
                </div>
              );

              const gridCell = "border-r border-[var(--border)] last:border-r-0";
              return stay?.href ? (
                <Link key={day} href={stay.href} className={cn(gridCell, "block hover:bg-[var(--muted)]/60")}>
                  {cell}
                </Link>
              ) : (
                <div key={day} className={gridCell}>
                  {cell}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-[var(--muted-foreground)]">
        <Legend className={sourceTone("airbnb")} label="Airbnb" />
        <Legend className={sourceTone("direct")} label="Direct" />
        <Legend className={sourceTone("booking_com")} label="Other channel" />
        <Legend className={BLOCK_TONE} label="Blocked" />
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-3 rounded-sm border-l-2", className)} />
      {label}
    </span>
  );
}
