/**
 * A small, strict iCalendar (RFC 5545) reader - just enough for calendar
 * availability feeds such as Airbnb's. Pure: no I/O, so it is unit-tested
 * directly.
 */

export interface ICalEvent {
  uid: string;
  /** ISO date of the first night. */
  start: string;
  /** ISO date after the last night (the check-out day). */
  end: string;
  summary: string;
  description: string;
  status: string | null;
}

/** An event as apply_airbnb_ical() expects it. */
export interface FeedEvent {
  uid: string;
  start: string;
  end: string;
  kind: "reservation" | "blocked";
  code: string | null;
}

export class ICalError extends Error {}

/** Undo RFC 5545 line folding: a line starting with space or tab continues the previous one. */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** Splits `NAME;PARAM=x;PARAM="a:b":VALUE` into its name and value. */
function splitProperty(line: string): { name: string; params: string; value: string } | null {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ":" && !inQuotes) {
      const head = line.slice(0, i);
      const semi = head.indexOf(";");
      return {
        name: (semi === -1 ? head : head.slice(0, semi)).toUpperCase(),
        params: semi === -1 ? "" : head.slice(semi + 1),
        value: line.slice(i + 1),
      };
    }
  }
  return null;
}

/**
 * The calendar date of a DATE or DATE-TIME value. Availability feeds use
 * whole days; for a timed value the date part is taken as written (UTC
 * values are converted to Dubai time first, so a late-evening UTC time does
 * not land on the wrong day).
 */
function toDate(value: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, ss, z] = m;
  if (hh && z) {
    const t = Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss) + 4 * 3_600_000;
    return new Date(t).toISOString().slice(0, 10);
  }
  const iso = `${y}-${mo}-${d}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

export function parseICal(text: string): ICalEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new ICalError("This is not an iCal calendar (no BEGIN:VCALENDAR).");
  }

  const events: ICalEvent[] = [];
  let current: Record<string, string> | null = null;

  for (const raw of unfold(text)) {
    const line = raw.trimEnd();
    if (!line) continue;
    const upper = line.toUpperCase();

    if (upper === "BEGIN:VEVENT") {
      current = {};
      continue;
    }
    if (upper === "END:VEVENT") {
      if (current) {
        const start = current.DTSTART ? toDate(current.DTSTART) : null;
        let end = current.DTEND ? toDate(current.DTEND) : null;
        if (start && (!end || end <= start)) end = nextDay(start);
        if (current.UID && start && end) {
          events.push({
            uid: current.UID.trim(),
            start,
            end,
            summary: unescapeText(current.SUMMARY ?? "").trim(),
            description: unescapeText(current.DESCRIPTION ?? "").trim(),
            status: current.STATUS ? current.STATUS.trim().toUpperCase() : null,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const prop = splitProperty(line);
    if (prop && !(prop.name in current)) current[prop.name] = prop.value;
  }

  return events;
}

/**
 * Airbnb's feed has two kinds of event: reservations (SUMMARY "Reserved",
 * with a reservation URL carrying the confirmation code) and "Airbnb (Not
 * available)" periods the host blocked on Airbnb. Cancelled events are
 * dropped, which makes the booking count as removed from the feed.
 */
export function toAirbnbEvents(events: ICalEvent[]): FeedEvent[] {
  return events
    .filter((e) => e.status !== "CANCELLED")
    .map((e) => {
      const blocked = /not available|unavailable|blocked/i.test(e.summary);
      const code =
        /reservations\/details\/([A-Z0-9]{6,})/i.exec(e.description)?.[1]?.toUpperCase() ??
        /\b(HM[A-Z0-9]{8})\b/.exec(`${e.summary} ${e.description}`)?.[1] ??
        null;
      return {
        uid: e.uid,
        start: e.start,
        end: e.end,
        kind: blocked ? ("blocked" as const) : ("reservation" as const),
        code: blocked ? null : code,
      };
    });
}
