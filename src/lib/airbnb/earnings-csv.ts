/**
 * Airbnb's earnings export (Earnings -> Transaction history -> Export CSV),
 * turned into booking amounts.
 *
 * The calendar feed carries dates and the confirmation code, never money, so
 * this is how Airbnb stays get their price: rows are matched to bookings by
 * confirmation code.
 *
 * Only "Reservation" rows are used. Payout rows repeat money already counted,
 * and adjustments or resolution payouts are not the stay's price. A long stay
 * Airbnb pays out in parts appears as several reservation rows with one code;
 * they are summed.
 *
 * Headers are matched loosely (case, spacing and punctuation ignored) because
 * Airbnb has renamed columns over time.
 */

export interface AirbnbEarnings {
  code: string;
  guest: string | null;
  currency: string | null;
  /** What Airbnb paid or will pay out for the stay. */
  amount: number;
  /** Airbnb's host service fee. */
  serviceFee: number;
  cleaningFee: number;
  /** Accommodation plus cleaning, before the host service fee. */
  grossEarnings: number;
  /** Taxes Airbnb collected from the guest (Dubai: Tourism Dirham). */
  occupancyTaxes: number;
  rows: number;
}

export interface EarningsParseResult {
  reservations: AirbnbEarnings[];
  /** Rows that were not reservations, by type, e.g. { Payout: 4 }. */
  skipped: Record<string, number>;
  errors: string[];
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const COLUMNS = {
  type: ["type"],
  code: ["confirmationcode", "confirmationnumber", "reservationcode"],
  guest: ["guest", "guestname"],
  currency: ["currency"],
  amount: ["amount", "paidout", "payout"],
  serviceFee: ["servicefee", "hostservicefee", "hostfee"],
  cleaningFee: ["cleaningfee"],
  grossEarnings: ["grossearnings"],
  occupancyTaxes: ["occupancytaxes", "occupancytax", "taxes"],
} as const;

/** "1,234.56", "(12.00)", "-12" and "" as numbers. */
export function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const negative = /^\(.*\)$/.test(trimmed) || trimmed.startsWith("-");
  const digits = trimmed.replace(/[^0-9.]/g, "");
  const n = Number(digits);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseAirbnbEarnings(text: string): EarningsParseResult {
  const rows = parseCsv(text);
  const errors: string[] = [];
  if (rows.length < 2) {
    return { reservations: [], skipped: {}, errors: ["The file has no rows."] };
  }

  const header = rows[0].map(norm);
  const col = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, names]) => [
      key,
      header.findIndex((h) => (names as readonly string[]).includes(h)),
    ])
  ) as Record<keyof typeof COLUMNS, number>;

  if (col.code < 0 || col.amount < 0) {
    return {
      reservations: [],
      skipped: {},
      errors: [
        "This does not look like Airbnb's earnings export: it needs a Confirmation code and an Amount column. " +
          "In Airbnb, open Earnings, then Transaction history, then Export CSV.",
      ],
    };
  }

  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const byCode = new Map<string, AirbnbEarnings>();
  const skipped: Record<string, number> = {};

  for (const r of rows.slice(1)) {
    const type = cell(r, col.type) || "Reservation";
    const code = cell(r, col.code).toUpperCase();
    if (!/^reservation$/i.test(type) || !code) {
      skipped[type] = (skipped[type] ?? 0) + 1;
      continue;
    }

    const entry =
      byCode.get(code) ??
      ({
        code,
        guest: cell(r, col.guest) || null,
        currency: cell(r, col.currency).toUpperCase() || null,
        amount: 0,
        serviceFee: 0,
        cleaningFee: 0,
        grossEarnings: 0,
        occupancyTaxes: 0,
        rows: 0,
      } satisfies AirbnbEarnings);

    entry.amount += parseAmount(cell(r, col.amount));
    entry.serviceFee += Math.abs(parseAmount(cell(r, col.serviceFee)));
    entry.cleaningFee += Math.abs(parseAmount(cell(r, col.cleaningFee)));
    entry.grossEarnings += Math.abs(parseAmount(cell(r, col.grossEarnings)));
    entry.occupancyTaxes += Math.abs(parseAmount(cell(r, col.occupancyTaxes)));
    entry.rows += 1;
    byCode.set(code, entry);
  }

  const reservations = [...byCode.values()].map((e) => ({
    ...e,
    amount: round2(e.amount),
    serviceFee: round2(e.serviceFee),
    cleaningFee: round2(e.cleaningFee),
    // Older exports have no gross column: payout plus the fee is the same thing.
    grossEarnings: round2(e.grossEarnings || e.amount + e.serviceFee),
    occupancyTaxes: round2(e.occupancyTaxes),
  }));

  return { reservations, skipped, errors };
}

/**
 * Booking columns for one Airbnb stay. Consistent with how a hand-entered
 * booking is priced: the guest total includes Tourism Dirham, and the payout
 * is that total less the channel's commission and the Tourism Dirham.
 */
export function earningsToBookingAmounts(e: AirbnbEarnings, nights: number) {
  const accommodation = round2(Math.max(0, e.grossEarnings - e.cleaningFee));
  return {
    accommodation_aed: accommodation,
    nightly_rate_aed: nights > 0 ? round2(accommodation / nights) : null,
    cleaning_fee_aed: e.cleaningFee,
    extra_fees_aed: 0,
    tourism_dirham_aed: e.occupancyTaxes,
    channel_commission_aed: e.serviceFee,
    gross_total_aed: round2(e.grossEarnings + e.occupancyTaxes),
    payout_expected_aed: e.amount,
  };
}
