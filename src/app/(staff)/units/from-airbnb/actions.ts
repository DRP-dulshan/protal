"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { mapAirbnbAmenities, parseAirbnbListing, type AirbnbListing } from "@/lib/airbnb/listing-page";
import { downloadAirbnbPhoto } from "@/lib/airbnb/listing-photos";
import { storeWebsitePhoto } from "@/lib/website-photos";
import { websiteDefaults } from "../[id]/website/defaults";
import type { WebsiteDefaults } from "../[id]/website/website-form";

const NOT_ALLOWED = "You do not have permission to edit units.";

async function allowed() {
  const profile = await requireProfile();
  return can(profile.role, "units.manage");
}

export type ListingCapture =
  | { error: string }
  | {
      listing: AirbnbListing;
      /** Website amenity ids found, and Airbnb names the website has no match for. */
      amenityIds: string[];
      unmatched: string[];
      /** The unit whose Airbnb calendar (or listing name) is this listing. */
      unitId: string | null;
    };

/**
 * Reads what the "Import listing to D|R|P" button (or a paste) sent and finds
 * the unit: the one whose Airbnb calendar address carries the listing's
 * number, else the one with the listing's name. Nothing is saved here.
 */
export async function readAirbnbListing(sent: unknown): Promise<ListingCapture> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  const listing = parseAirbnbListing(sent);
  if (!listing.title && !listing.description && !listing.photos.length && !listing.amenities.length) {
    return { error: "Nothing was found on that page. Open the listing on Airbnb (airbnb.com/rooms/…) and try again." };
  }

  const supabase = await createClient();
  const units = () =>
    supabase.from("units").select("id").eq("is_active", true).in("operating_mode", ["short_term", "both"]).limit(2);
  let unitId: string | null = null;
  if (listing.listingId) {
    const { data } = await units().ilike("airbnb_ical_url", `%/${listing.listingId}.ics%`);
    if (data?.length === 1) unitId = data[0].id;
  }
  if (!unitId && listing.title) {
    const { data } = await units().eq("airbnb_listing_name", listing.title);
    if (data?.length === 1) unitId = data[0].id;
  }

  const { ids, unmatched } = mapAirbnbAmenities(listing.amenities);
  return { listing, amenityIds: ids, unmatched, unitId };
}

export type ImportUnit = {
  id: string;
  label: string;
  bedrooms: number | null;
  bathrooms: number | null;
  maxGuests: number | null;
  hasRate: boolean;
};

/** The unit's Website form as it is now, to put the listing into. */
export async function loadUnitWebsite(unitId: string): Promise<{ error: string } | { unit: ImportUnit; defaults: WebsiteDefaults }> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Choose the unit." };
  const supabase = await createClient();
  const { data: u } = await supabase.from("units").select("*, properties(name)").eq("id", unitId).maybeSingle();
  if (!u) return { error: "Unit not found." };
  if (!u.is_active || u.operating_mode === "long_term") {
    return { error: "Only active short-term units go on the Holiday Homes website." };
  }
  return {
    unit: {
      id: u.id,
      label: [u.properties?.name, u.unit_number].filter(Boolean).join(" · "),
      bedrooms: u.bedrooms == null ? null : Number(u.bedrooms),
      bathrooms: u.bathrooms == null ? null : Number(u.bathrooms),
      maxGuests: u.max_guests,
      hasRate: Number(u.base_nightly_rate_aed) > 0,
    },
    defaults: websiteDefaults(u),
  };
}

/** Photos copied per call; the page sends a listing's photos a batch at a time. */
const PHOTOS_PER_CALL = 6;

/**
 * Copies listing photos from Airbnb into the portal's photo bucket, so the
 * website never loads Airbnb's copies. Only Airbnb's photo host is fetched.
 */
export async function copyAirbnbPhotos(urls: string[]): Promise<{ url?: string; error?: string }[]> {
  if (!(await allowed())) return [{ error: NOT_ALLOWED }];
  if (!Array.isArray(urls) || urls.length > PHOTOS_PER_CALL) return [{ error: "Too many photos at once." }];
  const supabase = await createClient();
  return Promise.all(
    urls.map(async (url) => {
      if (typeof url !== "string" || url.length > 1000) return { error: "Not an Airbnb photo address." };
      const photo = await downloadAirbnbPhoto(url);
      if ("error" in photo) return photo;
      return storeWebsitePhoto(supabase, photo.bytes, photo.type, photo.name);
    })
  );
}

const factsSchema = z.object({
  bedrooms: z.number().min(0).max(30).multipleOf(0.5).nullable(),
  bathrooms: z.number().min(0).max(30).multipleOf(0.5).nullable(),
  maxGuests: z.number().int().min(1).max(50).nullable(),
});

/** "Use Airbnb's numbers": the unit's bedrooms, bathrooms and max guests. */
export async function applyAirbnbFacts(unitId: string, facts: z.input<typeof factsSchema>): Promise<{ error?: string; success?: string }> {
  if (!(await allowed())) return { error: NOT_ALLOWED };
  const parsed = factsSchema.safeParse(facts);
  if (!z.string().uuid().safeParse(unitId).success || !parsed.success) return { error: "Those numbers could not be used." };
  const f = parsed.data;
  const change = {
    ...(f.bedrooms != null && { bedrooms: f.bedrooms }),
    ...(f.bathrooms != null && { bathrooms: f.bathrooms }),
    ...(f.maxGuests != null && { max_guests: f.maxGuests }),
  };
  if (!Object.keys(change).length) return { error: "Airbnb gave no numbers to use." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("units").update(change).eq("id", unitId).select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: NOT_ALLOWED };
  revalidatePath(`/units/${unitId}`);
  return { success: "The unit's bedrooms, bathrooms and guests are updated." };
}
