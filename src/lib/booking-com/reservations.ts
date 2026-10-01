/**
 * Booking.com's reservations export (extranet: Reservations > Download),
 * turned into stays. One row per reservation:
 *
 *   Property Name, Location, Booker Name, Genius Booker, Arrival, Departure,
 *   Booked on, Status, Total Payment, Commission, Currency, Reservation Number
 *
 * Headers are matched loosely (case, spacing and punctuation ignored) and a
 * few older names are accepted, as for Airbnb's export.
 */
import { parseAmount, parseCsv } from "@/lib/airbnb/earnings-csv";

export interface BookingReservation {
  code: string;
  property: string | null;
  guest: string | null;
  checkIn: string;
  checkOut: string;
  cancelled: boolean;
  /** What the guest pays. */
  total: number;
  /** Booking.com's commission. */
  commission: number;
  currency: string | null;
}

export interface BookingParseResult {
  reservations: BookingReservation[];
  /** Rows without a usable number or dates, by line. */
  skipped: string[];
  errors: string[];
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMNS = {
  code: ["reservationnumber", "booknumber", "bookingnumber", "reservationid", "bookingid"],
  property: ["propertyname", "property", "hotelname"],
  guest: ["bookername", "guestname", "guestnames", "guestnames"],
  arrival: ["arrival", "checkin", "checkindate"],
  departure: ["departure", "checkout", "checkoutdate"],
  status: ["status", "reservationstatus"],
  total: ["totalpayment", "price", "totalprice", "amount"],
  commission: ["commission", "commissionamount"],
  currency: ["currency"],
} as const;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const iso = (y: number, m: number, d: number): string | null => {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
};

/**
 * "July 12, 2026" (the extranet's own format), "12 Jul 2026", "2026-07-12"
 * and day-first "12/07/2026" (a file re-saved in Excel in Dubai).
 */
export function parseBookingDate(value: string): string | null {
  const v = value.trim();
  let m = v.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    return month ? iso(Number(m[3]), month, Number(m[2])) : null;
  }
  m = v.match(/^(\d{1,2}) ([A-Za-z]{3,9})\.?,? (\d{4})$/);
  if (m) {
    const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    return month ? iso(Number(m[3]), month, Number(m[1])) : null;
  }
  m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

export function parseBookingReservations(text: string): BookingParseResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { reservations: [], skipped: [], errors: ["The file has no rows."] };

  const header = rows[0].map(norm);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, names]) => [
      key,
      header.findIndex((h) => (names as readonly string[]).includes(h)),
    ])
  ) as Record<keyof typeof COLUMNS, number>;

  if (col.code < 0 || col.arrival < 0 || col.departure < 0) {
    return {
      reservations: [],
      skipped: [],
      errors: [
        "This does not look like Booking.com's reservations export: it needs Reservation Number, Arrival and Departure columns. " +
          "In the extranet, open Reservations, choose the dates and download the list as CSV.",
      ],
    };
  }

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const byCode = new Map<string, BookingReservation>();
  const skipped: string[] = [];

  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    const code = cell(r, col.code).replace(/\.0+$/, "");
    const checkIn = parseBookingDate(cell(r, col.arrival));
    const checkOut = parseBookingDate(cell(r, col.departure));
    if (!code || !checkIn || !checkOut || checkOut <= checkIn) {
      skipped.push(`Line ${line}${code ? ` (${code})` : ""}`);
      return;
    }
    byCode.set(code, {
      code,
      property: cell(r, col.property).replace(/\s+/g, " ") || null,
      guest: cell(r, col.guest) || null,
      checkIn,
      checkOut,
      cancelled: /cancel/i.test(cell(r, col.status)),
      total: Math.abs(parseAmount(cell(r, col.total))),
      commission: Math.abs(parseAmount(cell(r, col.commission))),
      currency: cell(r, col.currency).toUpperCase() || null,
    });
  });

  return { reservations: [...byCode.values()], skipped, errors: [] };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Booking columns for one Booking.com stay: the guest total, Booking.com's
 * commission, and the payout as what is left (Booking.com's export has no
 * separate cleaning fee or Tourism Dirham).
 */
export function bookingReservationAmounts(r: BookingReservation, nights: number) {
  return {
    accommodation_aed: round2(r.total),
    nightly_rate_aed: nights > 0 ? round2(r.total / nights) : null,
    cleaning_fee_aed: 0,
    extra_fees_aed: 0,
    tourism_dirham_aed: 0,
    channel_commission_aed: round2(r.commission),
    gross_total_aed: round2(r.total),
    payout_expected_aed: round2(r.total - r.commission),
  };
}
