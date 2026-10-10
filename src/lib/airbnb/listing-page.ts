/**
 * Reads an Airbnb listing for the unit's Website form, from what the "Import
 * listing to D|R|P" button collected on airbnb.com (see listing-collect.ts) or
 * from the listing page's text as staff copy and paste it.
 *
 * Airbnb publishes no API for listings and changes its pages often, so every
 * field may be missing, nothing is trusted beyond its shape, and staff check
 * the result in the form before anything is saved.
 */
import { slugify } from "@/lib/listings";
import { WEBSITE_AREAS, WEBSITE_TYPES } from "@/lib/website-options";

export interface AirbnbListing {
  url: string | null;
  listingId: string | null;
  title: string | null;
  description: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  guests: number | null;
  /** Amenity names as Airbnb shows them. */
  amenities: string[];
  /** Full-size photo addresses on muscache.com, in page order. */
  photos: string[];
}

export const MAX_IMPORTED_PHOTOS = 60;

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");
const strings = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];

/** Airbnb's own photo host only: an https address on muscache.com, nothing else. */
export function isAirbnbPhotoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return (
    u.protocol === "https:" &&
    (u.hostname === "muscache.com" || u.hostname.endsWith(".muscache.com")) &&
    u.port === "" &&
    u.username === "" &&
    u.password === ""
  );
}

/** The photo at full size: Airbnb sizes it down with ?im_w=720 and the like. */
export function fullSizePhotoUrl(raw: string): string | null {
  if (!isAirbnbPhotoUrl(raw)) return null;
  const u = new URL(raw);
  if (/\/(user|users|airbnb-platform-assets|ui)\//i.test(u.pathname)) return null;
  return `https://${u.hostname}${u.pathname}`;
}

export function listingIdOf(url: string | null): string | null {
  const m = url?.match(/airbnb\.[a-z.]+\/(?:rooms(?:\/plus)?|hosting\/listings(?:\/editor)?|hosting\/calendar|manage-your-space|multicalendar)\/(\d{3,25})/i);
  return m?.[1] ?? null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Airbnb's description HTML (<br />, <b>The space</b>) as plain paragraphs. */
export function htmlToText(html: string): string {
  return html
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h\d|ul|ol)\b[^>]*>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "2 bedrooms", "1.5 baths", "4 guests", "Studio" - the first of each kind. */
export function factsFrom(lines: string[]): { bedrooms: number | null; bathrooms: number | null; guests: number | null } {
  let bedrooms: number | null = null;
  let bathrooms: number | null = null;
  let guests: number | null = null;
  for (const line of lines) {
    if (bedrooms == null) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*bedrooms?\b/i);
      if (m) bedrooms = Number(m[1]);
      else if (/\bstudio\b/i.test(line) && /\b(guest|bed|bath)/i.test(line)) bedrooms = 0;
    }
    if (bathrooms == null) {
      const m = line.match(/(\d+(?:\.\d+)?)\s*(?:private |shared |dedicated )?(?:baths?|bathrooms?)\b/i);
      if (m) bathrooms = Number(m[1]);
      else if (/\bhalf-bath\b/i.test(line)) bathrooms = 0.5;
    }
    if (guests == null) {
      const m = line.match(/(\d+)\s*\+?\s*guests?\b/i);
      if (m) guests = Number(m[1]);
    }
  }
  const sane = (n: number | null, max: number) => (n != null && Number.isFinite(n) && n >= 0 && n <= max ? n : null);
  return { bedrooms: sane(bedrooms, 30), bathrooms: sane(bathrooms, 30), guests: sane(guests, 50) || null };
}

/** What the button sent (see AirbnbListingSent); any shape is accepted. */
export function parseAirbnbListing(sent: unknown): AirbnbListing {
  const s = (sent && typeof sent === "object" ? sent : {}) as Record<string, unknown>;
  const url = str(s.u, 500) || null;
  const text = str(s.text, 100_000);
  const fromText = text ? parseAirbnbListingText(text, url) : null;

  const photos: string[] = [];
  for (const raw of strings(s.photos, 200)) {
    const full = fullSizePhotoUrl(raw);
    if (full && !photos.includes(full)) photos.push(full);
  }

  const rawDesc = str(s.desc, 40_000);
  const description = rawDesc ? htmlToText(rawDesc) : fromText?.description ?? null;
  const facts = factsFrom(strings(s.facts, 50));
  const guests = typeof s.guests === "number" && s.guests > 0 && s.guests <= 50 ? Math.round(s.guests) : null;
  const amenities = cleanAmenities(strings(s.amenities, 200));

  return {
    url,
    listingId: listingIdOf(url),
    title: cleanTitle(str(s.title, 300)) ?? fromText?.title ?? null,
    description: description || null,
    bedrooms: facts.bedrooms ?? fromText?.bedrooms ?? null,
    bathrooms: facts.bathrooms ?? fromText?.bathrooms ?? null,
    guests: guests ?? facts.guests ?? fromText?.guests ?? null,
    amenities: amenities.length ? amenities : fromText?.amenities ?? [],
    photos: (photos.length ? photos : fromText?.photos ?? []).slice(0, 100),
  };
}

function cleanTitle(raw: string): string | null {
  const t = raw
    .replace(/\s*[-|·]\s*Airbnb\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  // A sharing title ("Rental unit in Dubai · ★4.9 · 2 bedrooms") is no name.
  if (!t || /★|·\s*\d+\s*bedrooms?/i.test(t)) return null;
  return t.slice(0, 200);
}

function cleanAmenities(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const n = raw.replace(/\s+/g, " ").trim();
    if (!n || n.length > 120 || /^unavailable:/i.test(n) || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    out.push(n);
  }
  return out;
}

const AMENITIES_START = /^what this place offers$/i;
const AMENITIES_END = /^(show all \d+ amenities|things to know|where you.ll (sleep|be)|\d+ reviews?|meet your host|availability|select check-in date|house rules|safety & property)/i;
const ABOUT_START = /^about this (space|place)$/i;
const ABOUT_END = /^(what this place offers|where you.ll (sleep|be)|show more|things to know|amenities)$/i;

/**
 * The listing page's text as a browser copies it (⌘A, ⌘C). The title is the
 * line before the page's "Share" and "Save" buttons; amenities and the
 * description are read from their sections when they were open.
 */
export function parseAirbnbListingText(text: string, url: string | null = null): AirbnbListing {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  let title: string | null = null;
  const share = lines.findIndex((l, i) => /^share$/i.test(l) && /^save$/i.test(lines[i + 1] ?? ""));
  if (share > 0) title = cleanTitle(lines[share - 1]);

  const amenities: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!AMENITIES_START.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && !AMENITIES_END.test(lines[j]); j++) {
      const l = lines[j];
      if (l.length <= 80 && !/^unavailable:/i.test(l) && !AMENITIES_START.test(l)) amenities.push(l);
    }
  }

  let description: string | null = null;
  const about = lines.findIndex((l) => ABOUT_START.test(l));
  if (about >= 0) {
    const body: string[] = [];
    for (let j = about + 1; j < lines.length && !ABOUT_END.test(lines[j]); j++) body.push(lines[j]);
    description = body.join("\n\n").slice(0, 20000) || null;
  }

  const photos: string[] = [];
  for (const m of text.matchAll(/https:\/\/[a-z0-9.-]*muscache\.com\/[^\s"'<>)]+/gi)) {
    const full = fullSizePhotoUrl(m[0]);
    if (full && !photos.includes(full)) photos.push(full);
  }

  const facts = factsFrom(lines.filter((l) => l.length < 120));
  return {
    url,
    listingId: listingIdOf(url) ?? listingIdOf(text.match(/https:\/\/www\.airbnb\.[a-z.]+\/rooms\/\d+/i)?.[0] ?? null),
    title,
    description,
    ...facts,
    amenities: cleanAmenities(amenities),
    photos: photos.slice(0, 100),
  };
}

/**
 * Airbnb amenity names → the website's amenity ids (WEBSITE_AMENITIES).
 * Names the website has no match for - and ones that only look alike, such
 * as a plain "Elevator" for "Direct elevator access" - are left out.
 */
const AMENITY_RULES: [RegExp, string][] = [
  [/\bprivate (outdoor |indoor |infinity |heated )*pool\b/, "pool"],
  [/\bshared (outdoor |indoor |infinity |heated |rooftop )*pool\b|\bcommunal pool\b/, "sharedPool"],
  [/\b(sea|ocean|beach) view\b/, "seaView"],
  [/\bmarina view\b/, "marinaView"],
  [/\b(city )?skyline view\b|\bburj (khalifa |al arab )?view\b/, "skylineView"],
  [/\bcanal view\b/, "canalView"],
  [/\bprivate (backyard|garden)\b/, "garden"],
  [/^free (parking|residential garage)\b/, "parking"],
  [/^gym\b|\bshared gym\b|\bgym in (the )?building\b/, "gym"],
  [/^beach access\b|\bbeachfront\b/, "beachAccess"],
  [/\bwi-?fi\b/, "wifi"],
  [/\bwasher\b|^(free |paid )?dryer\b|\bwashing machine\b/, "washer"],
  [/\bdedicated workspace\b/, "workspace"],
  [/^pets allowed\b/, "petsAllowed"],
  [/^housekeeping\b(?!.*\b(extra|fee|cost|request)\b)/, "housekeeping"],
  [/\b24\/7 security\b|\bsecurity guard\b/, "security"],
  [/\b(private|direct) (elevator|lift)\b/, "elevator"],
  [/\bair conditioning\b|\bsplit-type ductless system\b/, "airCon"],
  [/^kitchen\b|\bfull kitchen\b/, "kitchen"],
  [/\bsauna\b/, "sauna"],
  [/\bsteam room\b/, "steamRoom"],
  [/\bbbq\b|\bbarbecue\b/, "bbq"],
  [/\bsmart lock\b|\bkeypad\b/, "smartLock"],
  [/\bbasketball court\b/, "basketball"],
];

export function mapAirbnbAmenities(names: string[]): { ids: string[]; unmatched: string[] } {
  const ids: string[] = [];
  const unmatched: string[] = [];
  for (const name of names) {
    const n = name.toLowerCase().replace(/[–—]/g, "-");
    const hits = AMENITY_RULES.filter(([re]) => re.test(n)).map(([, id]) => id);
    if (!hits.length) unmatched.push(name);
    for (const id of hits) if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unmatched };
}

/** A web address from the title, in the units_website_slug_format shape. */
export function suggestSlug(title: string | null): string {
  return slugify(title ?? "")
    .slice(0, 80)
    .replace(/-+$/, "");
}

const AREA_ALIASES: [RegExp, (typeof WEBSITE_AREAS)[number]][] = [
  [/\bpalm jumeirah\b|\bthe palm\b/, "Palm Jumeirah"],
  [/\bdubai marina\b|\bmarina gate\b|\bjbr\b|\bjumeirah beach residence\b/, "Dubai Marina"],
  [/\bjvt\b|\bjumeirah village triangle\b/, "JVT"],
  [/\bbusiness bay\b/, "Business Bay"],
  [/\bdifc\b|\bfinancial centre\b/, "DIFC"],
  [/\bjvc\b|\bjumeirah village circle\b/, "JVC"],
  [/\bsports city\b/, "Dubai Sports City"],
  [/\bmeydan\b/, "Meydan"],
  [/\bdowntown\b|\bburj khalifa\b|\bdubai mall\b/, "Downtown Dubai"],
];

/**
 * The website area, when the title names exactly one. Descriptions name the
 * places nearby too ("10 minutes to Downtown"), so they are not read.
 */
export function suggestArea(l: Pick<AirbnbListing, "title">): string {
  const t = (l.title ?? "").toLowerCase();
  const found = new Set(AREA_ALIASES.filter(([re]) => re.test(t)).map(([, a]) => a));
  return found.size === 1 ? [...found][0] : "";
}

/** The website type, when the title makes it plain (or Airbnb says studio). */
export function suggestType(l: Pick<AirbnbListing, "title" | "bedrooms">): string {
  const order: [RegExp, (typeof WEBSITE_TYPES)[number]][] = [
    [/\bpenthouse\b/, "penthouse"],
    [/\bvilla\b/, "villa"],
    [/\btown ?house\b/, "townhouse"],
    [/\bstudio\b/, "studio"],
    [/\b(apartment|apt|flat|condo|rental unit)\b/, "apartment"],
  ];
  const t = (l.title ?? "").toLowerCase();
  return order.find(([re]) => re.test(t))?.[1] ?? (l.bedrooms === 0 ? "studio" : "");
}

/** The Website form fields an import fills in. */
export interface ImportableWebsite {
  title: string;
  slug: string;
  type: string;
  area: string;
  description: string;
  amenities: string[];
  images: string[];
}

/**
 * The unit's Website form with the listing put in, for staff to check before
 * saving: Airbnb's title, description and photos (copied to the portal),
 * amenities added to the ones already ticked, and a web address, area and
 * type only where the unit has none yet.
 */
export function mergeListing<D extends ImportableWebsite>(
  d: D,
  l: AirbnbListing,
  photos: string[],
  keepPhotos: boolean
): D {
  const images = keepPhotos || photos.length === 0 ? [...d.images, ...photos.filter((p) => !d.images.includes(p))] : photos;
  const amenities = [...d.amenities];
  for (const id of mapAirbnbAmenities(l.amenities).ids) if (!amenities.includes(id)) amenities.push(id);
  return {
    ...d,
    title: l.title || d.title,
    slug: d.slug || suggestSlug(l.title),
    type: d.type || suggestType(l),
    area: d.area || suggestArea(l),
    description: l.description || d.description,
    amenities,
    images: images.slice(0, MAX_IMPORTED_PHOTOS),
  };
}
