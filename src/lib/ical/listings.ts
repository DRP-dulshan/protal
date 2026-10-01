import { FEED_CHANNEL_NAME, isChannelCalendarUrl, type FeedChannel } from "./url";

/** One Airbnb listing to add as a holiday-home unit. */
export interface ListingRow {
  /** Position in the form, 1-based, counting empty rows too. */
  row: number;
  building: string;
  unitNumber: string;
  bedrooms: number;
  link: string;
  /** Direct-booking prices; only those filled in. */
  prices: ListingPrices;
}

export interface ListingPrices {
  nightly?: number;
  weekend?: number;
  cleaning?: number;
  weeklyDiscount?: number;
  monthlyDiscount?: number;
}

const PRICE_FIELDS: { key: keyof ListingPrices; label: string; max?: number }[] = [
  { key: "nightly", label: "nightly price" },
  { key: "weekend", label: "weekend price" },
  { key: "cleaning", label: "cleaning fee" },
  { key: "weeklyDiscount", label: "weekly discount", max: 99 },
  { key: "monthlyDiscount", label: "monthly discount", max: 99 },
];

export const MAX_LISTINGS = 30;

/** The listing number in an Airbnb export link (/calendar/ical/<id>.ics). */
export function airbnbListingId(link: string): string | null {
  try {
    return new URL(link).pathname.match(/\/ical\/(\d+)\.ics$/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates the rows of the "Add Airbnb listings" form. Rows left completely
 * empty are dropped; every other problem is reported against its row number
 * (1-based, as the form shows them) so nothing is created until all are fixed.
 */
export function parseListingRows(
  fields: {
  building: string[];
  unitNumber: string[];
  bedrooms: string[];
  link: string[];
} & Partial<Record<keyof ListingPrices, string[]>>,
  channel: FeedChannel = "airbnb"
): { rows: ListingRow[]; errors: string[] } {
  const site = FEED_CHANNEL_NAME[channel];
  const rows: ListingRow[] = [];
  const errors: string[] = [];
  const seenLinks = new Map<string, number>();
  const seenUnits = new Map<string, number>();
  const count = Math.max(fields.building.length, fields.unitNumber.length, fields.link.length);

  for (let i = 0; i < count; i++) {
    const building = (fields.building[i] ?? "").trim().replace(/\s+/g, " ");
    const unitNumber = (fields.unitNumber[i] ?? "").trim();
    const link = (fields.link[i] ?? "").trim();
    const bedrooms = Number(fields.bedrooms[i] ?? 1);
    if (!building && !unitNumber && !link) continue;

    const n = i + 1;
    if (!link) errors.push(`Row ${n}: paste the listing's ${site} calendar link.`);
    else if (!isChannelCalendarUrl(channel, link)) {
      errors.push(`Row ${n}: that is not ${channel === "airbnb" ? "an" : "a"} ${site} calendar link.`);
    }
    if (!building) errors.push(`Row ${n}: enter the building or community.`);
    else if (building.length > 120) errors.push(`Row ${n}: the building name is too long.`);
    if (!unitNumber) errors.push(`Row ${n}: enter the unit number.`);
    else if (unitNumber.length > 30) errors.push(`Row ${n}: the unit number is too long.`);
    if (!Number.isFinite(bedrooms) || bedrooms < 0 || bedrooms > 20) {
      errors.push(`Row ${n}: choose the number of bedrooms.`);
    }
    const prices: ListingPrices = {};
    for (const { key, label, max } of PRICE_FIELDS) {
      const raw = (fields[key]?.[i] ?? "").trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || (max !== undefined && value > max)) {
        errors.push(`Row ${n}: the ${label} must be a number${max !== undefined ? ` from 0 to ${max}` : " of 0 or more"}.`);
      } else {
        prices[key] = value;
      }
    }

    if (link) {
      const earlier = seenLinks.get(link);
      if (earlier) errors.push(`Row ${n}: the same ${site} link is already in row ${earlier}.`);
      else seenLinks.set(link, n);
    }
    if (building && unitNumber) {
      const key = `${building.toLowerCase()}|${unitNumber.toLowerCase()}`;
      const earlier = seenUnits.get(key);
      if (earlier) errors.push(`Row ${n}: ${building} ${unitNumber} is already in row ${earlier}.`);
      else seenUnits.set(key, n);
    }

    rows.push({ row: n, building, unitNumber, bedrooms, link, prices });
  }

  if (rows.length === 0 && errors.length === 0) errors.push("Add at least one listing.");
  if (rows.length > MAX_LISTINGS) {
    errors.push(`Add up to ${MAX_LISTINGS} listings at a time.`);
  }
  return { rows, errors };
}
