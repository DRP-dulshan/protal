import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Callout, Field, FieldGrid, Money, PageHeader } from "@/components/domain/shared";
import { BookingStatusBadge, ChannelBadge } from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { SALES_CHANNEL } from "@/lib/labels";
import { BookingActions } from "./booking-actions";

export const metadata = { title: "Booking" };

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireCapability("bookings.view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: b } = await supabase
    .from("bookings")
    .select(
      "*, guests(id, full_name, email, phone, nationality, passport_number), units(id, unit_number, properties(name))"
    )
    .eq("id", id)
    .maybeSingle();
  if (!b) notFound();

  const unitLabel = `${b.units?.properties?.name ?? ""} · ${b.units?.unit_number ?? ""}`;
  const guestCount = [
    `${b.adults} adult${b.adults === 1 ? "" : "s"}`,
    b.children ? `${b.children} child${b.children === 1 ? "" : "ren"}` : null,
    b.infants ? `${b.infants} infant${b.infants === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }, { label: b.booking_number }]}
        title={b.guests?.full_name ?? b.booking_number}
        description={`${b.booking_number} · ${unitLabel}`}
        actions={
          can(profile.role, "bookings.manage") ? (
            <BookingActions bookingId={b.id} status={b.status} />
          ) : undefined
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <BookingStatusBadge status={b.status} />
        <ChannelBadge channel={b.channel} />
      </div>

      {b.status === "cancelled" && (
        <div className="mb-5">
          <Callout tone="warning" title={`Cancelled on ${formatDate(b.cancelled_on)}`}>
            {b.cancellation_reason || "No reason recorded."}
          </Callout>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Stay</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Unit">
                {b.units ? (
                  <Link href={`/units/${b.units.id}`} className="hover:underline">
                    {unitLabel}
                  </Link>
                ) : (
                  "—"
                )}
              </Field>
              <Field label="Nights">{b.nights}</Field>
              <Field label="Check-in">{formatDate(b.check_in)}</Field>
              <Field label="Check-out">{formatDate(b.check_out)}</Field>
              <Field label="Guests">{guestCount}</Field>
              <Field label="Channel">
                {SALES_CHANNEL[b.channel]}
                {b.external_booking_id && ` · ${b.external_booking_id}`}
              </Field>
              <Field label="DET permit at booking">{b.permit_number_at_booking ?? "—"}</Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Guest</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Name">{b.guests?.full_name ?? "—"}</Field>
              <Field label="Phone">{b.guests?.phone ?? "—"}</Field>
              <Field label="Email">{b.guests?.email ?? "—"}</Field>
              <Field label="Nationality">{b.guests?.nationality ?? "—"}</Field>
              <Field label="Passport">{b.guests?.passport_number ?? "—"}</Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Price</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={3}>
              <Field label="Nightly rate"><Money amount={b.nightly_rate_aed} /></Field>
              <Field label="Accommodation"><Money amount={b.accommodation_aed} /></Field>
              <Field label="Cleaning fee"><Money amount={b.cleaning_fee_aed} /></Field>
              <Field label="Other fees"><Money amount={b.extra_fees_aed} /></Field>
              <Field label="Tourism Dirham"><Money amount={b.tourism_dirham_aed} /></Field>
              <Field label="Channel commission"><Money amount={b.channel_commission_aed} /></Field>
              <Field label="Guest pays"><Money amount={b.gross_total_aed} className="font-semibold" /></Field>
              <Field label="Expected payout"><Money amount={b.payout_expected_aed} /></Field>
              <Field label="Damage deposit"><Money amount={b.damage_deposit_aed} /></Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">From the guest</p>
              <p className="whitespace-pre-line">{b.guest_message || "—"}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Internal</p>
              <p className="whitespace-pre-line">{b.internal_notes || "—"}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
