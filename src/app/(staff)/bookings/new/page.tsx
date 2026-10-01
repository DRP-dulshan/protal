import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { formatDate } from "@/lib/dates";
import { addDays, dubaiToday } from "@/lib/calendar";
import type { PricedStay } from "@/lib/pricing";
import { BookingForm } from "./booking-form";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = { title: "New booking" };

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; checkIn?: string; checkOut?: string; block?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  // Opened from a "Blocked on Airbnb" period on the unit's calendar: the
  // dates and the block's note come with it.
  const checkIn = params.checkIn && ISO_DATE.test(params.checkIn) ? params.checkIn : undefined;
  const checkOut =
    params.checkOut && ISO_DATE.test(params.checkOut) && (!checkIn || params.checkOut > checkIn)
      ? params.checkOut
      : undefined;
  const blockId = params.block && UUID.test(params.block) ? params.block : undefined;

  const [, unitsResult, guestsResult, pricesResult, blockResult, airbnbResult] = await Promise.all([

    requireCapability("bookings.manage"),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name, has_valid_permit, base_nightly_rate_aed")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("property_name")
      .order("unit_number"),
    supabase.from("guests").select("id, full_name").order("full_name").limit(1000),
    supabase
      .from("units")
      .select("id, weekend_rate_aed, cleaning_fee_aed, weekly_discount_pct, monthly_discount_pct")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"]),
    blockId
      ? supabase
          .from("availability_blocks")
          .select("unit_id, start_date, end_date, note")
          .eq("id", blockId)
          .eq("reason", "channel_sync")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // What Airbnb guests paid a night at each unit over the last year and
    // ahead: the starting rate for a direct stay (see airbnbRateNear).
    supabase
      .from("bookings")
      .select("unit_id, check_in, check_out, nightly_rate_aed")
      .eq("channel", "airbnb")
      .in("status", ["confirmed", "checked_in", "checked_out"])
      .gt("nightly_rate_aed", 0)
      .gte("check_in", addDays(dubaiToday(), -365))
      .limit(5000),
  ]);
  const airbnbStays: Record<string, PricedStay[]> = {};
  for (const b of airbnbResult.data ?? []) {
    (airbnbStays[b.unit_id] ??= []).push({
      checkIn: b.check_in,
      checkOut: b.check_out,
      nightlyRate: Number(b.nightly_rate_aed),
    });
  }
  const block = blockResult.data;
  const blockNote = block?.note && !/^Not available on /.test(block.note) ? block.note : null;
  const prices = new Map((pricesResult.data ?? []).map((p) => [p.id, p]));

  const units = (unitsResult.data ?? []).map((u) => ({
    id: u.id!,
    label: `${u.property_name} · ${u.unit_number}`,
    nightlyRate: u.base_nightly_rate_aed,
    weekendRate: prices.get(u.id!)?.weekend_rate_aed ?? null,
    cleaningFee: prices.get(u.id!)?.cleaning_fee_aed ?? null,
    weeklyDiscountPct: prices.get(u.id!)?.weekly_discount_pct ?? null,
    monthlyDiscountPct: prices.get(u.id!)?.monthly_discount_pct ?? null,
    hasValidPermit: Boolean(u.has_valid_permit),
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }]}
        title="New booking"
        description="A holiday home stay. The dates are held on the calendar as soon as it is tentative or confirmed."
      />
      {units.length === 0 && (
        <div className="mb-5">
          <Callout tone="info" title="No holiday home units">
            Set a unit&apos;s operating mode to Holiday home or Dual mode (Units → Edit) to
            take bookings for it.
          </Callout>
        </div>
      )}
      {block && (
        <div className="mb-5">
          <Callout tone="info" title="A direct stay in an Airbnb block">
            Blocked on Airbnb {formatDate(block.start_date)} → {formatDate(block.end_date)}
            {blockNote ? ` (${blockNote})` : ""}. The dates are filled in; add the guest and
            the price.
          </Callout>
        </div>
      )}
      <BookingForm
        units={units}
        guests={guestsResult.data ?? []}
        airbnbStays={airbnbStays}
        today={dubaiToday()}
        defaultUnitId={block?.unit_id ?? params.unit}
        defaultCheckIn={checkIn}
        defaultCheckOut={checkOut}
        defaultNotes={blockNote ?? undefined}
        cancelHref={block ? `/units/${block.unit_id}?tab=calendar` : undefined}
      />
    </>
  );
}
