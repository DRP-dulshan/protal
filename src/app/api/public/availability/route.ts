import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { dubaiToday } from "@/lib/calendar";
import { PUBLIC_HEADERS } from "@/lib/website-api";

/**
 * GET /api/public/availability - the nights that can't be booked, per
 * published home, from today on: bookings (website, Airbnb, Booking.com,
 * direct), owner stays, maintenance and channel holds all appear as calendar
 * blocks. `end` is exclusive (the first night that is free again).
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();
  const today = dubaiToday();
  const { data: units, error } = await supabase
    .from("units")
    .select("id, website_slug")
    .eq("website_published", true)
    .eq("is_active", true);
  if (error) {
    return NextResponse.json({ error: "Availability is temporarily unavailable." }, { status: 503, headers: PUBLIC_HEADERS });
  }

  const ids = (units ?? []).map((u) => u.id);
  const { data: blocks, error: blockError } = ids.length
    ? await supabase
        .from("availability_blocks")
        .select("unit_id, start_date, end_date")
        .in("unit_id", ids)
        .gt("end_date", today)
        .order("start_date")
    : { data: [], error: null };
  if (blockError) {
    return NextResponse.json({ error: "Availability is temporarily unavailable." }, { status: 503, headers: PUBLIC_HEADERS });
  }

  const bySlug = new Map((units ?? []).map((u) => [u.id, u.website_slug as string]));
  const homes: Record<string, { start: string; end: string }[]> = {};
  for (const slug of bySlug.values()) homes[slug] = [];
  for (const b of blocks ?? []) {
    const slug = bySlug.get(b.unit_id);
    if (slug) homes[slug].push({ start: b.start_date, end: b.end_date });
  }
  return NextResponse.json({ asOf: today, homes }, { headers: PUBLIC_HEADERS });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PUBLIC_HEADERS });
}
