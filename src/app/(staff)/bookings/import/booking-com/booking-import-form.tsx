"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/domain/shared";
import { FormError } from "@/components/domain/form";
import { importBookingReservations, type BookingImportState } from "../../booking-com-actions";
import { MatchListings, Submit } from "../import-form";

export function BookingImportForm() {
  const [state, action] = useActionState<BookingImportState, FormData>(importBookingReservations, {});

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-5">
          <form action={action} className="space-y-4">
            <FormError message={state.error} />
            <div className="space-y-1.5">
              <Label htmlFor="file">Booking.com reservations (CSV)</Label>
              <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
            </div>
            <Submit />
          </form>
        </CardContent>
      </Card>

      {(state.unmatched?.length ?? 0) > 0 && (
        <MatchListings state={state} action={action} site="Booking.com" noun="property" nouns="properties" />
      )}

      {state.success && (
        <Callout tone="info" title={state.success}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {(state.cancelledElsewhere ?? 0) > 0 && (
              <li>
                {state.cancelledElsewhere} cancelled {state.cancelledElsewhere === 1 ? "reservation was" : "reservations were"} never
                in the portal: nothing to do.
              </li>
            )}
            {(state.overlapping?.length ?? 0) > 0 && (
              <li>
                Already in the portal on the same dates, left as they are: {state.overlapping!.join(", ")}.
              </li>
            )}
            {(state.otherCurrency?.length ?? 0) > 0 && (
              <li>Not in AED, left out: {state.otherCurrency!.join(", ")}.</li>
            )}
            {(state.failed?.length ?? 0) > 0 && <li>Could not be saved: {state.failed!.join("; ")}.</li>}
            {(state.skipped?.length ?? 0) > 0 && (
              <li>Rows without a reservation number or dates, ignored: {state.skipped!.join(", ")}.</li>
            )}
          </ul>
          <p className="mt-2">
            <Link href="/bookings?channel=booking_com&view=all" className="underline underline-offset-2">
              See Booking.com bookings
            </Link>
          </p>
        </Callout>
      )}
    </div>
  );
}
