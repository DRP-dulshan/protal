import { differenceInCalendarDays, format, parseISO, isValid } from "date-fns";

/** Dubai runs on a fixed UTC+4 offset with no daylight saving. */
export const TIMEZONE = "Asia/Dubai";

const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) return null;
  const d = typeof value === "string" ? parseISO(value) : value;
  return isValid(d) ? d : null;
};

export function formatDate(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "dd MMM yyyy") : "—";
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "dd MMM yyyy, HH:mm") : "—";
}

export function formatMonth(value: string | Date | null | undefined): string {
  const d = toDate(value);
  return d ? format(d, "MMMM yyyy") : "—";
}

/** Negative means the date has already passed. */
export function daysUntil(value: string | Date | null | undefined): number | null {
  const d = toDate(value);
  return d ? differenceInCalendarDays(d, new Date()) : null;
}

export function relativeExpiry(value: string | Date | null | undefined): string {
  const days = daysUntil(value);
  if (days === null) return "—";
  if (days < 0) return `${Math.abs(days)} days overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  if (days <= 60) return `in ${days} days`;
  return formatDate(value);
}

/** Matches the severity banding in v_compliance_status. */
export type Severity = "ok" | "due_soon" | "urgent" | "overdue" | "missing";

export function severityFor(daysRemaining: number | null): Severity {
  if (daysRemaining === null) return "missing";
  if (daysRemaining < 0) return "overdue";
  if (daysRemaining <= 7) return "urgent";
  if (daysRemaining <= 60) return "due_soon";
  return "ok";
}

export function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function monthBounds(date = new Date()): { start: string; end: string } {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start: format(start, "yyyy-MM-dd"), end: format(end, "yyyy-MM-dd") };
}
