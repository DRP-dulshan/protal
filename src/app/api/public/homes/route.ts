import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { toWebsiteHome } from "@/lib/website-homes";
import { PUBLIC_HEADERS } from "@/lib/website-api";

/**
 * GET /api/public/homes - the holiday homes published to the Holiday Homes
 * website, in the shape of its own Property type. Public by design: it carries
 * only what the website shows anyway (no owner, address, permit or contact data).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("units")
    .select("*")
    .eq("website_published", true)
    .eq("is_active", true)
    .order("website_title");
  if (error) {
    return NextResponse.json({ error: "Homes are temporarily unavailable." }, { status: 503, headers: PUBLIC_HEADERS });
  }
  const homes = (data ?? []).map(toWebsiteHome).filter((h) => h !== null);
  return NextResponse.json({ homes }, { headers: PUBLIC_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
