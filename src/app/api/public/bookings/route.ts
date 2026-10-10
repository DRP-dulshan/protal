import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { parseDbError, STATUS_FOR_CODE, websiteAuthError } from "@/lib/website-api";

/**
 * POST /api/public/bookings - a booking made on the Holiday Homes website.
 * Authenticated with WEBSITE_API_KEY. The booking is held as "tentative" until
 * the website confirms the guest's payment (PATCH /api/public/bookings/<ref>),
 * and lands on the calendar at once, so Airbnb's imported feed and every other
 * channel see the nights as taken.
 */
export const dynamic = "force-dynamic";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().finite().min(0).max(10_000_000);

const schema = z.object({
  ref: z.string().regex(/^[A-Z0-9-]{4,24}$/),
  slug: z.string().min(1).max(120),
  checkIn: isoDate,
  checkOut: isoDate,
  guests: z.number().int().min(1).max(30),
  status: z.enum(["tentative", "confirmed"]).default("tentative"),
  guest: z.object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().max(200),
    phone: z.string().trim().min(6).max(30),
    nationality: z.string().trim().max(80).optional(),
  }),
  // The website's own quote, in AED. The portal records it; it does not re-price.
  quote: z.object({
    nightlyRate: money,
    accommodation: money,
    cleaningFee: money,
    tourismFee: money,
    total: money,
  }),
  message: z.string().max(2000).optional(),
  notes: z.string().max(2000).optional(),
});

export async function POST(request: Request) {
  const denied = websiteAuthError(request);
  if (denied) return denied;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid booking.", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  const b = parsed.data;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("website_book_unit", {
    p_slug: b.slug,
    p_ref: b.ref,
    p_check_in: b.checkIn,
    p_check_out: b.checkOut,
    p_adults: b.guests,
    p_guest_name: b.guest.name,
    p_guest_email: b.guest.email,
    p_guest_phone: b.guest.phone,
    p_nationality: b.guest.nationality ?? "",
    p_status: b.status,
    p_nightly: b.quote.nightlyRate,
    p_accommodation: b.quote.accommodation,
    p_cleaning: b.quote.cleaningFee,
    p_tourism: b.quote.tourismFee,
    p_gross: b.quote.total,
    p_message: b.message ?? "",
    p_notes: `Website booking ${b.ref}${b.notes ? `\n${b.notes}` : ""}`,
  } as never);

  if (error) {
    const { code, message } = parseDbError(error.message);
    return NextResponse.json({ error: message, code }, { status: STATUS_FOR_CODE[code] ?? 500 });
  }
  const row = (Array.isArray(data) ? data[0] : data) as { booking_id: string; booking_number: string } | null;
  return NextResponse.json({ ok: true, id: row?.booking_id, number: row?.booking_number }, { status: 201 });
}
