"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  COMPLETIONS,
  FURNISHINGS,
  PHOTO_BUCKET,
  PROPERTY_TYPES,
  fromWebsiteListing,
  imagesOf,
  slugify,
  toFeatures,
  type ListingRow,
} from "@/lib/listings";
import { rebuildWebsite } from "@/lib/website";
import { env } from "@/lib/env";

export type ListingState = { error?: string; success?: string };

const NOT_ALLOWED = "You do not have permission to edit website listings.";

async function requireEditor() {
  const profile = await requireProfile();
  return can(profile.role, "website.manage") ? profile : null;
}

/** Our own photo bucket's public URL prefix, to tell our uploads from links. */
function ownPhotoPath(url: string, supabaseUrl: string): string | null {
  const prefix = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/`;
  return url.startsWith(prefix) ? decodeURIComponent(url.slice(prefix.length)) : null;
}

const blank = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal("").transform(() => undefined), schema]).optional();

const listingSchema = z
  .object({
    title: z.string().trim().min(3, "Give the listing a title").max(200),
    slug: z.string().trim().max(120).optional(),
    status: z.enum(["draft", "published", "hidden"]),
    offering: z.enum(["buy", "rent"]),
    price: z.coerce.number().positive("Enter the price"),
    propertyType: z.enum(PROPERTY_TYPES),
    completion: z.enum(COMPLETIONS),
    furnishing: blank(z.enum(FURNISHINGS)),
    area: z.string().trim().min(2, "Enter the area").max(80),
    building: z.string().trim().max(120).optional(),
    mapQuery: z.string().trim().max(200).optional(),
    mapExact: z.literal("on").optional(),
    beds: z.coerce.number().int().min(0).max(20),
    baths: z.coerce.number().int().min(0).max(20),
    size: z.coerce.number().int().positive("Enter the size in sq ft"),
    description: z.string().max(20000).optional(),
    features: z.string().max(5000).optional(),
    agent: z.string().trim().max(120).optional(),
    listedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the listing date"),
    ref: z.string().trim().max(60).optional(),
    permit: z.string().trim().max(60).optional(),
    sourceUrl: blank(z.string().trim().url("The Property Finder link must be a full https:// address").max(500)),
    unitId: blank(z.string().uuid()),
    images: z.string().max(50000),
  })
  .transform((v, ctx) => {
    let images: string[] = [];
    try {
      const parsed = JSON.parse(v.images);
      images = Array.isArray(parsed) ? parsed.filter((u): u is string => typeof u === "string" && /^https:\/\//.test(u)) : [];
    } catch {
      ctx.addIssue({ code: "custom", message: "The photos could not be read. Reload the page." });
    }
    return { ...v, images: [...new Set(images)].slice(0, 60) };
  })
  .refine((v) => v.status !== "published" || v.images.length > 0, {
    message: "Add at least one photo before putting the listing on the website.",
  });

/**
 * Creates (id null) or updates a website listing. A listing on the website
 * - before or after the change - starts a website rebuild.
 */
export async function saveListing(
  id: string | null,
  _prev: ListingState,
  formData: FormData
): Promise<ListingState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  if (id !== null && !z.string().uuid().safeParse(id).success) return { error: "Listing not found." };

  const parsed = listingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const v = parsed.data;
  const slug = slugify(v.slug || v.title);
  if (!slug) return { error: "The web address needs letters or numbers." };

  const supabase = await createClient();
  const row = {
    slug,
    status: v.status,
    title: v.title,
    offering: v.offering,
    price_aed: v.price,
    property_type: v.propertyType,
    completion: v.completion,
    furnishing: v.furnishing ?? null,
    area: v.area,
    building: v.building || null,
    map_query: v.mapQuery || null,
    map_exact: v.mapExact === "on",
    beds: v.beds,
    baths: v.baths,
    size_sqft: v.size,
    description: (v.description ?? "").replace(/\r\n/g, "\n").trim(),
    features: toFeatures(v.features ?? ""),
    agent: v.agent || null,
    listed_at: v.listedAt,
    ref: v.ref || null,
    permit: v.permit || null,
    source_url: v.sourceUrl ?? null,
    unit_id: v.unitId ?? null,
    images: v.images,
    updated_by: profile.id,
  };

  let before: { status: string; images: ListingRow["images"] } | null = null;
  let savedId = id;
  if (id) {
    const { data } = await supabase.from("website_listings").select("status, images").eq("id", id).maybeSingle();
    if (!data) return { error: "Listing not found." };
    before = data;
    const { data: changed, error } = await supabase.from("website_listings").update(row).eq("id", id).select("id");
    if (error) return { error: explain(error) };
    if (!changed?.length) return { error: NOT_ALLOWED };
  } else {
    const { data, error } = await supabase
      .from("website_listings")
      .insert({ ...row, created_by: profile.id })
      .select("id")
      .single();
    if (error) return { error: explain(error) };
    savedId = data.id;
  }

  // Photos uploaded here and since removed from the listing.
  if (before) {
    const kept = new Set(v.images);
    const gone = imagesOf(before)
      .filter((u) => !kept.has(u))
      .map((u) => ownPhotoPath(u, env.supabaseUrl))
      .filter((p): p is string => Boolean(p));
    if (gone.length) await supabase.storage.from(PHOTO_BUCKET).remove(gone);
  }

  const touchesWebsite = v.status === "published" || before?.status === "published";
  const rebuild = touchesWebsite ? await rebuildWebsite() : null;

  revalidatePath("/website/listings");
  revalidatePath(`/website/listings/${savedId}`);
  const note = !touchesWebsite ? "saved" : rebuild?.started ? "live" : "pending";
  redirect(`/website/listings?saved=${note}`);
}

function explain(error: { code?: string; message: string }): string {
  if (error.code === "23505") return "Another listing already uses this web address. Change the address (or the title).";
  if (error.code === "42501") return NOT_ALLOWED;
  if (error.code === "23514") return "One of the values is not accepted. Check the price, size and web address.";
  return error.message;
}

export async function deleteListing(id: string): Promise<ListingState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  if (!z.string().uuid().safeParse(id).success) return { error: "Listing not found." };

  const supabase = await createClient();
  const { data: removed, error } = await supabase
    .from("website_listings")
    .delete()
    .eq("id", id)
    .select("status, images");
  if (error) return { error: explain(error) };
  const listing = removed?.[0];
  if (!listing) return { error: "This listing could not be deleted." };

  const own = imagesOf(listing)
    .map((u) => ownPhotoPath(u, env.supabaseUrl))
    .filter((p): p is string => Boolean(p));
  if (own.length) await supabase.storage.from(PHOTO_BUCKET).remove(own);

  const rebuild = listing.status === "published" ? await rebuildWebsite() : null;
  revalidatePath("/website/listings");
  redirect(`/website/listings?saved=${listing.status !== "published" ? "deleted" : rebuild?.started ? "live" : "pending"}`);
}

const MAX_PHOTO = 10 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

/** Uploads one photo to the public bucket and returns its address. */
export async function uploadListingPhoto(formData: FormData): Promise<{ url?: string; error?: string }> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a photo." };
  if (file.size > MAX_PHOTO) return { error: `${file.name} is larger than 10 MB.` };
  if (!PHOTO_TYPES.has(file.type)) return { error: `${file.name}: use JPG, PNG, WebP or AVIF.` };

  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" }[file.type];
  const base = slugify(file.name.replace(/\.[^.]+$/, "")).slice(0, 40) || "photo";
  const path = `${new Date().toISOString().slice(0, 7)}/${randomBytes(6).toString("hex")}-${base}.${ext}`;

  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
  if (error) return { error: `Upload failed: ${error.message}` };
  return { url: supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
}

/** "Update website now": a rebuild without changing anything. */
export async function rebuildWebsiteNow(): Promise<ListingState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };
  const result = await rebuildWebsite();
  if (result.started) return { success: "The website is rebuilding. Changes appear in about 2 minutes." };
  return {
    error:
      result.reason === "not_configured"
        ? "The website rebuild is not connected yet (WEBSITE_DEPLOY_HOOK_URL). Changes appear on the website's next deploy."
        : `The website did not start rebuilding (${result.reason}). Try again in a minute.`,
  };
}

export type ImportState = ListingState & {
  added?: number;
  updated?: number;
  /** Already in the portal, left as they are. */
  unchanged?: number;
  /** Entries the website does not show (commercial units) or that could not be read. */
  skipped?: number;
};

/**
 * Brings the website's current listings into the portal, from its data file
 * (listings.json) - uploaded, or fetched from a link to it. Listings are
 * matched by web address: new ones are added as published, ones already
 * here are left as they are unless "update" is ticked.
 */
export async function importWebsiteListings(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const profile = await requireEditor();
  if (!profile) return { error: NOT_ALLOWED };

  let text: string;
  const file = formData.get("file");
  const link = String(formData.get("url") ?? "").trim();
  if (file instanceof File && file.size > 0) {
    if (file.size > 20_000_000) return { error: "That file is too large." };
    text = await file.text();
  } else if (link) {
    if (!/^https:\/\//.test(link)) return { error: "The link must start with https://" };
    try {
      const response = await fetch(link, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
      if (!response.ok) return { error: `The link answered HTTP ${response.status}.` };
      text = await response.text();
    } catch {
      return { error: "The link could not be reached." };
    }
  } else {
    return { error: "Choose the listings.json file, or paste a link to it." };
  }

  let items: unknown;
  try {
    items = JSON.parse(text);
  } catch {
    return { error: "That is not a listings file (it is not JSON)." };
  }
  if (!Array.isArray(items)) return { error: "That is not a listings file (expected a list of listings)." };

  const rows = items.map(fromWebsiteListing);
  const valid = rows.filter((r): r is NonNullable<typeof r> => r !== null);
  const skipped = rows.length - valid.length;
  if (valid.length === 0) return { error: "No listings in this file could be read.", skipped };

  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase.from("website_listings").select("slug");
  if (readError) return { error: readError.message };
  const known = new Set((existing ?? []).map((r) => r.slug));
  const overwrite = formData.get("update") === "on";

  const fresh = valid.filter((r) => !known.has(r.slug));
  const repeat = overwrite ? valid.filter((r) => known.has(r.slug)) : [];

  if (fresh.length) {
    const { error } = await supabase
      .from("website_listings")
      .insert(fresh.map((r) => ({ ...r, status: "published", created_by: profile.id, updated_by: profile.id })));
    if (error) return { error: `Nothing was imported: ${explain(error)}` };
  }
  for (const r of repeat) {
    const { error } = await supabase
      .from("website_listings")
      .update({ ...r, updated_by: profile.id })
      .eq("slug", r.slug);
    if (error) return { error: `Stopped at ${r.slug}: ${explain(error)}`, added: fresh.length };
  }

  if (fresh.length || repeat.length) await rebuildWebsite();
  revalidatePath("/website/listings");
  return {
    success: "Import finished.",
    added: fresh.length,
    updated: repeat.length,
    unchanged: overwrite ? 0 : valid.length - fresh.length,
    skipped,
  };
}
