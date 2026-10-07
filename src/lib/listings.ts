import type { Tables } from "@/lib/db/database.types";

/**
 * Website listings (migration 0028): the values the D|R|P website accepts and
 * the shape it reads them in. The website's own data file
 * (new-home: data/imported/listings.json) defines that shape; the public
 * feed, the import and the portal form all go through here so they agree.
 */

export const OFFERINGS = { buy: "For sale", rent: "For rent" } as const;
export const PROPERTY_TYPES = ["Apartment", "Penthouse", "Townhouse", "Villa"] as const;
export const COMPLETIONS = ["Ready", "Off-Plan"] as const;
export const FURNISHINGS = ["Furnished", "Unfurnished"] as const;
export const LISTING_STATUSES = {
  draft: "Draft",
  published: "On the website",
  hidden: "Hidden",
} as const;

export type Offering = keyof typeof OFFERINGS;
export type ListingStatus = keyof typeof LISTING_STATUSES;
export type ListingRow = Tables<"website_listings">;

export const PHOTO_BUCKET = "listing-photos";

/** "2 BR Apartment for Rent in Marina Gate!" -> "2-br-apartment-for-rent-in-marina-gate" */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .replace(/-+$/g, "");
}

/** Paragraphs are separated by a blank line in the portal, a list on the website. */
export const toParagraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/** One feature per line (or comma), duplicates and blanks dropped. */
export function toFeatures(text: string): string[] {
  const seen = new Set<string>();
  return text
    .split(/\n|,/)
    .map((f) => f.trim())
    .filter((f) => f && !seen.has(f.toLowerCase()) && seen.add(f.toLowerCase()));
}

export const imagesOf = (row: Pick<ListingRow, "images">): string[] =>
  Array.isArray(row.images) ? row.images.filter((x): x is string => typeof x === "string") : [];

/** What the website's map searches for when no query was typed. */
export const defaultMapQuery = (building: string | null, area: string) =>
  [building, area, "Dubai"].filter(Boolean).join(", ");

/** A listing as the website reads it - the shape of its listings.json. */
export interface WebsiteListing {
  slug: string;
  ref: string;
  permit: string | null;
  title: string;
  offering: Offering;
  price: number;
  type: string;
  area: string;
  building: string | null;
  beds: number;
  baths: number;
  size: number;
  completion: string;
  furnishing: string | null;
  listedAt: string;
  agent: string | null;
  images: string[];
  description: string[];
  features: string[];
  sourceUrl: string;
  map: { query: string; exact: boolean };
}

export function toWebsiteListing(row: ListingRow): WebsiteListing {
  return {
    slug: row.slug,
    ref: row.ref || row.slug,
    permit: row.permit || null,
    title: row.title,
    offering: row.offering as Offering,
    price: Number(row.price_aed),
    type: row.property_type,
    area: row.area,
    building: row.building || null,
    beds: row.beds,
    baths: row.baths,
    size: row.size_sqft,
    completion: row.completion,
    furnishing: row.furnishing || null,
    listedAt: row.listed_at,
    agent: row.agent || null,
    images: imagesOf(row),
    description: toParagraphs(row.description),
    features: row.features ?? [],
    sourceUrl: row.source_url || "",
    map: { query: row.map_query || defaultMapQuery(row.building, row.area), exact: row.map_exact },
  };
}

/**
 * A listing from the website's own data file (its Property Finder listings),
 * as a row. Commercial units and anything else the website does not show are
 * left out (null). Used to check that the feed's shape matches that file.
 */
export function fromWebsiteListing(x: unknown): Omit<ListingRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "unit_id" | "status"> | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));
  const slug = str(r.slug);
  const title = str(r.title);
  const type = str(r.type);
  const area = str(r.area);
  const price = num(r.price);
  const size = Math.round(num(r.size));
  if (!slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || !title || !area) return null;
  if (!type || !(PROPERTY_TYPES as readonly string[]).includes(type)) return null;
  if (r.offering !== "buy" && r.offering !== "rent") return null;
  if (!(price > 0) || !(size > 0)) return null;
  const map = (r.map && typeof r.map === "object" ? r.map : {}) as Record<string, unknown>;
  const listedAt = str(r.listedAt);
  return {
    slug,
    title: title.replace(/\s+l\s+/g, " | ").replace(/\s*\|\s*$/, "").trim(),
    offering: r.offering,
    price_aed: price,
    property_type: type,
    area,
    building: str(r.building),
    map_query: str(map.query),
    map_exact: map.exact === true,
    beds: Math.max(0, Math.min(20, Math.round(num(r.beds)) || 0)),
    baths: Math.max(0, Math.min(20, Math.round(num(r.baths)) || 0)),
    size_sqft: size,
    completion: r.completion === "Off-Plan" ? "Off-Plan" : "Ready",
    furnishing: r.furnishing === "Furnished" || r.furnishing === "Unfurnished" ? r.furnishing : null,
    listed_at: listedAt && /^\d{4}-\d{2}-\d{2}/.test(listedAt) ? listedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
    agent: str(r.agent),
    images: Array.isArray(r.images) ? r.images.filter((i): i is string => typeof i === "string" && /^https:\/\//.test(i)) : [],
    description: Array.isArray(r.description)
      ? r.description.filter((p): p is string => typeof p === "string").join("\n\n")
      : (str(r.description) ?? ""),
    features: Array.isArray(r.features) ? r.features.filter((f): f is string => typeof f === "string") : [],
    ref: str(r.ref),
    permit: str(r.permit),
    source_url: str(r.sourceUrl),
  };
}
