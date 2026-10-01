import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BookingStatusBadge,
  ChannelBadge,
} from "@/components/domain/status-badge";
import { formatDate } from "@/lib/dates";
import type { Views } from "@/lib/db/database.types";

export type OwnerBooking = Views<"owner_bookings_view">;

/**
 * The owner's booking list. Its only data source is owner_bookings_view, which
 * has no money columns - there is nothing here that could show a price even
 * by mistake.
 */
export function OwnerBookingsTable({
  bookings,
  showProperty = true,
  showGuestName = false,
}: {
  bookings: OwnerBooking[];
  showProperty?: boolean;
  showGuestName?: boolean;
}) {
  return (
    <>
      {/* Phones: one stacked row per stay; a seven-column table does not fit. */}
      <ul className="divide-y divide-[var(--border)] sm:hidden">
        {bookings.map((b) => (
          <li key={b.id} className="space-y-1 px-4 py-3 text-sm">
            {showProperty && (
              <Link
                href={`/portal/owner/units/${b.unit_id}`}
                className="block font-medium hover:underline"
              >
                {b.property_name} · {b.unit_number}
              </Link>
            )}
            <p className="tabular">
              {formatDate(b.check_in)} → {formatDate(b.check_out)}
              <span className="text-[var(--muted-foreground)]">
                {" "}
                · {b.nights} {b.nights === 1 ? "night" : "nights"}
                {b.guests != null &&
                  ` · ${b.guests} ${b.guests === 1 ? "guest" : "guests"}`}
                {showGuestName &&
                  b.guest_first_name &&
                  ` · ${b.guest_first_name}`}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {b.source && <ChannelBadge channel={b.source} />}
              {b.status && <BookingStatusBadge status={b.status} />}
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              {showProperty && <TableHead>Property</TableHead>}
              <TableHead>Check-in</TableHead>
              <TableHead>Check-out</TableHead>
              <TableHead className="text-right">Nights</TableHead>
              <TableHead className="text-right">Guests</TableHead>
              {showGuestName && <TableHead>Guest</TableHead>}
              <TableHead>Source</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bookings.map((b) => (
              <TableRow key={b.id}>
                {showProperty && (
                  <TableCell>
                    <Link
                      href={`/portal/owner/units/${b.unit_id}`}
                      className="font-medium hover:underline"
                    >
                      {b.property_name} · {b.unit_number}
                    </Link>
                  </TableCell>
                )}
                <TableCell className="tabular whitespace-nowrap">
                  {formatDate(b.check_in)}
                </TableCell>
                <TableCell className="tabular whitespace-nowrap">
                  {formatDate(b.check_out)}
                </TableCell>
                <TableCell className="tabular text-right">{b.nights}</TableCell>
                <TableCell className="tabular text-right">
                  {b.guests ?? (
                    <span
                      className="text-xs text-[var(--muted-foreground)]"
                      title="Airbnb calendar feeds do not include the guest count"
                    >
                      Not provided
                    </span>
                  )}
                </TableCell>
                {showGuestName && (
                  <TableCell>{b.guest_first_name ?? "—"}</TableCell>
                )}
                <TableCell>
                  {b.source && <ChannelBadge channel={b.source} />}
                </TableCell>
                <TableCell className="text-right">
                  {b.status && <BookingStatusBadge status={b.status} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
