"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Callout } from "@/components/domain/shared";
import { FormError } from "@/components/domain/form";
import { formatDate } from "@/lib/dates";
import { importAirbnbEarnings, type ImportState } from "../actions";

function Submit({ label = "Import" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Upload className="size-4" />
      {pending ? "Importing…" : label}
    </Button>
  );
}

/**
 * Past stays need a unit, and the file names only the Airbnb listing. Each
 * listing is matched once; the unit remembers it for every later import.
 */
function MatchListings({
  state,
  action,
}: {
  state: ImportState;
  action: (formData: FormData) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Match Airbnb listings to units</CardTitle>
        <p className="text-sm text-[var(--muted-foreground)]">
          The file has stays for these listings that are not in the portal. Choose the unit each
          one is, and those stays are added. This is asked once per listing; leave one blank to
          skip it for now.
        </p>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <input type="hidden" name="csvText" value={state.csvText ?? ""} />
          {state.unmatched!.map((m) => (
            <div key={m.listing} className="grid gap-2 sm:grid-cols-2 sm:items-center">
              <div className="text-sm">
                <p className="font-medium">{m.listing}</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {m.stays} {m.stays === 1 ? "stay" : "stays"} to add
                </p>
              </div>
              <input type="hidden" name="matchListing" value={m.listing} />
              <Select name="matchUnit" defaultValue="" aria-label={`Unit for ${m.listing}`}>
                <option value="">Skip for now</option>
                {state.units!.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
          <Submit label="Save matches and import" />
        </form>
      </CardContent>
    </Card>
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

      {(state.unmatched?.length ?? 0) > 0 && <MatchListings state={state} action={action} />}

      {state.success && (
        <Callout tone="info" title={state.success}>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {(state.overlapping?.length ?? 0) > 0 && (
              <li>
                Already in the portal on the same dates, left as they are:{" "}
                {state.overlapping!.join(", ")}.
              </li>
            )}
            {(state.failed?.length ?? 0) > 0 && (
              <li>
                Could not be added: {state.failed!.join("; ")}.
              </li>
            )}
            {(state.notFound?.length ?? 0) > 0 && (
              <li>
                Not added ({state.notFound!.length}): {state.notFound!.join(", ")}. The file has no
                dates or listing name for these.
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
