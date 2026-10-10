import type { Tables } from "@/lib/db/database.types";

/**
 * Holiday homes as the Holiday Homes website reads them (migration 0029).
 * The website's own `Property` type is the contract: everything it shows and
 * prices a stay with is here, so a unit published in the portal needs no
 * change on the website.
 */

export type UnitRow = Tables<"units">;

export interface WebsiteSeason {
  name?: string;
  from: string;
  to: string;
  rate: number;
}

export interface WebsiteHome {
  slug: string;
  title: string;
  area: string;
  building: string | null;
  type: string;
  bedrooms: number;
  bathrooms: number;
  guests: number;
  sizeSqft: number | null;
  minNights: number;
  pricePerNight: number;
  cleaningFee: number;
  pricing: {
    weekendRate: number | null;
    weeklyDiscountPct: number | null;
    monthlyDiscountPct: number | null;
    seasons: WebsiteSeason[];
  };
  tag: string;
  image: string;
  gallery: string[];
  amenities: string[];
  highlights: string[];
  description: string;
  houseRules: string[];
  checkIn: string;
  checkOut: string;
  lat: number | null;
  lng: number | null;
  mapsUrl: string | null;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export const imagesOf = (unit: Pick<UnitRow, "website_images">): string[] =>
  Array.isArray(unit.website_images)
    ? unit.website_images.filter((x): x is string => typeof x === "string" && /^https:\/\//.test(x))
    : [];

/** Only well-formed season rows leave the portal; a typo in one can't break the website's pricing. */
export function seasonsOf(unit: Pick<UnitRow, "website_seasons">): WebsiteSeason[] {
  if (!Array.isArray(unit.website_seasons)) return [];
  const out: WebsiteSeason[] = [];
  for (const raw of unit.website_seasons) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const s = raw as Record<string, unknown>;
    const rate = num(s.rate);
    if (typeof s.from !== "string" || typeof s.to !== "string" || !ISO.test(s.from) || !ISO.test(s.to)) continue;
    if (s.to < s.from || rate == null || rate < 1) continue;
    out.push({ from: s.from, to: s.to, rate, ...(typeof s.name === "string" && s.name ? { name: s.name } : {}) });
  }
  return out;
}

/** "bedrooms" is numeric(3,1) in the portal (1.5 allowed); the website counts whole bedrooms. */
const wholeBedrooms = (v: number) => Math.max(0, Math.floor(v));

/** Null when the unit lacks what the website needs (the database refuses to publish those too). */
export function toWebsiteHome(unit: UnitRow): WebsiteHome | null {
  const images = imagesOf(unit);
  const rate = num(unit.base_nightly_rate_aed);
  if (
    !unit.website_slug ||
    !unit.website_title ||
    !unit.website_area ||
    !unit.website_type ||
    !images.length ||
    rate == null ||
    rate <= 0 ||
    !unit.max_guests
  ) {
    return null;
  }
  return {
    slug: unit.website_slug,
    title: unit.website_title,
    area: unit.website_area,
    building: unit.website_building,
    type: unit.website_type,
    bedrooms: wholeBedrooms(Number(unit.bedrooms)),
    bathrooms: Math.max(1, Math.ceil(Number(unit.bathrooms))),
    guests: unit.max_guests,
    sizeSqft: unit.size_sqft == null ? null : Math.round(Number(unit.size_sqft)),
    minNights: Math.max(1, unit.min_nights ?? 1),
    pricePerNight: Math.round(rate),
    cleaningFee: Math.round(num(unit.cleaning_fee_aed) ?? 0),
    pricing: {
      weekendRate: num(unit.weekend_rate_aed),
      weeklyDiscountPct: num(unit.weekly_discount_pct),
      monthlyDiscountPct: num(unit.monthly_discount_pct),
      seasons: seasonsOf(unit),
    },
    tag: unit.website_tag ?? "",
    image: images[0],
    gallery: images,
    amenities: unit.website_amenities ?? [],
    highlights: unit.website_highlights ?? [],
    description: unit.website_description ?? "",
    houseRules: unit.website_house_rules ?? [],
    checkIn: unit.website_check_in,
    checkOut: unit.website_check_out,
    lat: num(unit.website_lat),
    lng: num(unit.website_lng),
    mapsUrl: unit.website_maps_url,
  };
}
