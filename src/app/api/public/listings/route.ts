import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { toWebsiteListing } from "@/lib/listings";

/**
 * GET /api/public/listings - every listing published to the D|R|P website,
 * newest first, in the shape of the website's own data file
 * (data/imported/listings.json). The website reads it when it builds.
 *
 * Public by design: it carries only what the website shows anyway. Drafts
 * and hidden listings never leave the portal.
 */
export const dynamic = "force-dynamic";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  // Read at build time right after a change: never serve a stale copy.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("website_listings")
    .select("*")
    .eq("status", "published")
    .order("listed_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: "Listings are temporarily unavailable." }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json((data ?? []).map(toWebsiteListing), { headers: HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: HEADERS });
}
