"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Callout } from "@/components/domain/shared";
import { FormError } from "@/components/domain/form";
import { formatDate } from "@/lib/dates";
import { importAirbnbEarnings, type ImportState } from "../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Upload className="size-4" />
      {pending ? "Importing…" : "Import"}
    </Button>
  );
}

export function ImportForm() {
  const [state, action] = useActionState<ImportState, FormData>(importAirbnbEarnings, {});
  const skipped = Object.entries(state.skipped ?? {});

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-5">
          <form action={action} className="space-y-4">
            <FormError message={state.error} />
            <div className="space-y-1.5">
              <Label htmlFor="file">Airbnb earnings CSV</Label>
              <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
            </div>
            <Submit />
          </form>
        </CardContent>
      </Card>

      {state.success && (
        <Callout tone="info" title={state.success}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {(state.notFound?.length ?? 0) > 0 && (
              <li>
                Not in the portal yet ({state.notFound!.length}): {state.notFound!.join(", ")}. These
                stays have not come in from the Airbnb calendar, or their unit has no calendar link.
                Sync the calendar and import the file again.
              </li>
            )}
            {(state.otherCurrency?.length ?? 0) > 0 && (
              <li>
                Not in AED, left unpriced: {state.otherCurrency!.join(", ")}. Enter these on the
                booking page.
              </li>
            )}
            {skipped.length > 0 && (
              <li>
                Ignored rows that are not reservations:{" "}
                {skipped.map(([type, n]) => `${n} ${type}`).join(", ")}.
              </li>
            )}
          </ul>
          {(state.stillMissingTotal ?? 0) > 0 && (
            <div className="mt-3">
              <p className="font-medium">
                Still without a price, not in this file ({state.stillMissingTotal}):
              </p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {state.stillMissing!.map((m) => (
                  <li key={m.id}>
                    <Link href={`/bookings/${m.id}`} className="underline underline-offset-2">
                      {m.code}
                    </Link>{" "}
                    · {m.unit} · check-in {formatDate(m.checkIn)}
                  </li>
                ))}
              </ul>
              <p className="mt-1">
                In Airbnb, export both the Paid and the Upcoming tab of Transaction history, with
                dates covering these stays, and import both files. Or open a stay and enter the
                payout Airbnb shows on the reservation.
              </p>
            </div>
          )}
          <p className="mt-2">
            <Link href="/bookings?view=needs_price" className="underline underline-offset-2">
              See stays still without a price
            </Link>
          </p>
        </Callout>
      )}
    </div>
  );
}
