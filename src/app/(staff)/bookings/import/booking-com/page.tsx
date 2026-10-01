import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/shared";
import { BookingImportForm } from "./booking-import-form";
import { ClearBookingMatchButton } from "./clear-match";

export const metadata = { title: "Import Booking.com reservations" };

export default async function ImportBookingReservationsPage() {
  await requireCapability("bookings.manage");
  const supabase = await createClient();
  const { data: matched } = await supabase
    .from("units")
    .select("id, unit_number, booking_listing_name, properties(name)")
    .not("booking_listing_name", "is", null)
    .order("booking_listing_name");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings?channel=booking_com" }]}
        title="Import Booking.com reservations"
        description="Adds every Booking.com reservation in the file, with the guest and price, and cancels the ones Booking.com cancelled."
      />

      <Card className="mb-5">
        <CardContent className="space-y-2 p-5 text-sm">
          <p className="font-medium">Getting the file from Booking.com</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>In the extranet (group view), open Reservations.</li>
            <li>
              Choose the dates - past and upcoming - and download the list as <strong>CSV</strong>. If
              you only get an Excel file, open it and save it as CSV.
            </li>
            <li>Upload it here. Importing the same file again is safe.</li>
          </ol>
          <p className="text-[var(--muted-foreground)]">
            Each reservation&apos;s guest, total, Booking.com commission and payout (total less
            commission) are filled in. Stays from the Booking.com calendar get their reservation
            number; stays not in the portal yet are added - past ones as checked out - without
            notifying anyone. The first time a property appears you choose its unit. Owners never
            see the amounts.
          </p>
        </CardContent>
      </Card>

      <BookingImportForm />

      {(matched?.length ?? 0) > 0 && (
        <Card className="mt-5">
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-medium">Booking.com properties matched to units</p>
            <ul className="divide-y divide-[var(--border)]">
              {matched!.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{u.booking_listing_name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {u.properties?.name} · {u.unit_number}
                    </span>
                  </span>
                  <ClearBookingMatchButton unitId={u.id} listing={u.booking_listing_name!} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
