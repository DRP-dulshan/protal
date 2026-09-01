import { CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import {
  PageHeader,
  Field,
  FieldGrid,
  Money,
  EmptyState,
} from "@/components/domain/shared";
import { BookingStatusBadge } from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "My stay" };

/**
 * Minimal guest view: their booking and check-in details.
 *
 * The full guest experience from Module E — digital registration, house rules,
 * messaging the host — is part of the Holiday Homes portal build. This exists
 * so a guest login lands somewhere useful rather than on a dead route.
 */
export default async function GuestPortalPage() {
  await requireRole(["guest"]);
  const supabase = await createClient();

  // RLS returns only bookings belonging to this login, via guests.profile_id.
  const { data } = await supabase
    .from("bookings")
    .select("*, units(unit_number, floor, properties(name, address_line))")
    .order("check_in", { ascending: false });

  const bookings = data ?? [];
  const current = bookings[0];

  if (!current) {
    return (
      <>
        <PageHeader title="My stay" />
        <EmptyState
          title="No booking found"
          description="Your booking details will appear here once a reservation is confirmed."
          icon={<CalendarDays className="size-8" />}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`${current.units?.properties?.name} · ${current.units?.unit_number}`}
        description={`Booking ${current.booking_number}`}
      />

      <div className="mb-5">
        <BookingStatusBadge status={current.status} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Your stay</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Check in">
                {formatDate(current.check_in)}
                {current.check_in_time && ` from ${current.check_in_time.slice(0, 5)}`}
              </Field>
              <Field label="Check out">
                {formatDate(current.check_out)}
                {current.check_out_time && ` by ${current.check_out_time.slice(0, 5)}`}
              </Field>
              <Field label="Nights">{current.nights}</Field>
              <Field label="Guests">
                {current.adults} adults
                {current.children > 0 && `, ${current.children} children`}
              </Field>
              <Field label="Address" className="sm:col-span-2">
                {current.units?.properties?.address_line ?? "—"}
                {current.units?.floor && ` · Floor ${current.units.floor}`}
              </Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Charges</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Accommodation">
                <Money amount={current.accommodation_aed} />
              </Field>
              <Field label="Cleaning fee">
                <Money amount={current.cleaning_fee_aed} />
              </Field>
              <Field label="Tourism Dirham fee">
                <Money amount={current.tourism_dirham_aed} />
              </Field>
              <Field label="Total">
                <Money amount={current.gross_total_aed} />
              </Field>
              <Field label="Damage deposit">
                <Money amount={current.damage_deposit_aed} />
              </Field>
              <Field label="DET permit">
                {current.permit_number_at_booking ?? "—"}
              </Field>
            </FieldGrid>
          </CardContent>
        </Card>
      </div>

      {bookings.length > 1 && (
        <Card className="mt-5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Previous stays</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {bookings.slice(1).map((booking) => (
              <div
                key={booking.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-2 text-sm last:border-0"
              >
                <span>
                  {booking.units?.properties?.name} · {booking.units?.unit_number}
                  <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                    {formatDate(booking.check_in)} – {formatDate(booking.check_out)}
                  </span>
                </span>
                <BookingStatusBadge status={booking.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}
