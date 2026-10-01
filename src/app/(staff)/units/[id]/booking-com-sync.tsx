"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/domain/form";
import { saveBookingLink, syncUnitNow, type SyncActionState } from "../../bookings/calendar-sync-actions";
import { SyncStatusBadge } from "./channel-sync";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving and syncing…" : "Save & sync"}
    </Button>
  );
}

/**
 * Booking.com calendar import for one unit. Kept apart from Airbnb's: its
 * own link, status and stays. There is no export to Booking.com - D|R|P does
 * not sync the two channels' calendars with each other.
 */
export function BookingComSync(props: {
  unitId: string;
  url: string | null;
  lastSynced: string | null;
  status: string | null;
  error: string | null;
  eventCount: number | null;
  canManage: boolean;
}) {
  const [state, save] = useActionState<SyncActionState, FormData>(
    saveBookingLink.bind(null, props.unitId),
    {}
  );
  const [syncing, startSync] = useTransition();

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  return (
    <Card className="mb-5">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Booking.com calendar sync</CardTitle>
        <div className="flex items-center gap-2">
          <SyncStatusBadge status={props.url ? props.status : null} />
          {props.canManage && props.url && (
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() =>
                startSync(async () => {
                  const result = await syncUnitNow(props.unitId, "booking_com");
                  if (result.success) toast.success(result.success);
                  if (result.error) toast.error(result.error);
                })
              }
            >
              <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-[var(--muted-foreground)]">
          Checked every 15 minutes. New Booking.com reservations appear as bookings (dates only;
          import the reservations export for the guest and price); ones that disappear from
          Booking.com are cancelled here.
        </p>

        {props.url && (
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Last synced</dt>
              <dd>{props.lastSynced ?? "Never"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">Events in feed</dt>
              <dd className="tabular">{props.eventCount ?? "—"}</dd>
            </div>
            {props.status === "error" && props.error && (
              <div className="sm:col-span-3">
                <dt className="text-xs uppercase tracking-wide text-[var(--destructive)]">Problem</dt>
                <dd className="text-[var(--destructive)]">{props.error}</dd>
              </div>
            )}
          </dl>
        )}

        {props.canManage ? (
          <form action={save} className="mt-3 space-y-2">
            <FormError message={state.error} />
            <Label htmlFor="bookingIcalUrl">Booking.com calendar link</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="bookingIcalUrl"
                name="bookingIcalUrl"
                type="url"
                defaultValue={props.url ?? ""}
                placeholder="https://ical.booking.com/v1/export?t=…"
                className="font-mono text-xs"
              />
              <SaveButton />
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              In the Booking.com extranet: Rates &amp; Availability → Sync calendars → Export
              calendar. Leave empty and save to stop syncing.
            </p>
          </form>
        ) : (
          !props.url && <p className="mt-3 text-sm text-[var(--muted-foreground)]">No Booking.com link set.</p>
        )}
      </CardContent>
    </Card>
  );
}
