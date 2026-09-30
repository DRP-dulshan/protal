import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { BookingForm } from "./booking-form";

export const metadata = { title: "New booking" };

export default async function NewBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [, unitsResult, guestsResult, pricesResult] = await Promise.all([

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
  ]);
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
      <BookingForm units={units} guests={guestsResult.data ?? []} defaultUnitId={params.unit} />
    </>
  );
}
