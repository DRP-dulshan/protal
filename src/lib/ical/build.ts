/**
 * Writes an iCalendar feed of blocked dates for Airbnb to import. Pure, so it
 * is unit-tested directly.
 *
 * Deliberately says as little as possible: each event is "Reserved" or
 * "Blocked" with its dates. Anyone holding the URL learns which nights are
 * taken - never by whom, never at what price.
 */

export interface ExportEvent {
  uid: string;
  start: string; // ISO date, first blocked night
  end: string; // ISO date, first free night again
  kind: string; // 'booking' | block reason
}

const CRLF = "\r\n";

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 folds lines longer than 75 octets. */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length === 0 ? 75 : 74)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join(`${CRLF} `);
}

const compactDate = (iso: string) => iso.replaceAll("-", "");

function stamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function buildICal({
  name,
  events,
  now = new Date(),
}: {
  name: string;
  events: ExportEvent[];
  now?: Date;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DRP Property Management//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  const dtstamp = stamp(now);
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeText(e.uid)}@drp-pms`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${compactDate(e.start)}`,
      `DTEND;VALUE=DATE:${compactDate(e.end)}`,
      `SUMMARY:${e.kind === "booking" ? "Reserved" : "Blocked"}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join(CRLF) + CRLF;
}
