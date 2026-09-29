"use client";

import * as React from "react";
import { useActionState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Check, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FormError } from "@/components/domain/form";
import {
  regenerateExportLink,
  saveAirbnbLink,
  syncUnitNow,
  type SyncActionState,
} from "../../bookings/calendar-sync-actions";

export interface ChannelSyncProps {
  unitId: string;
  airbnbUrl: string | null;
  exportUrl: string;
  lastSynced: string | null; // already formatted, Dubai time
  status: string | null;
  error: string | null;
  eventCount: number | null;
  flaggedCount: number;
  canManage: boolean;
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving and syncing…" : "Save & sync"}
    </Button>
  );
}

export function SyncStatusBadge({ status }: { status: string | null }) {
  if (status === "ok") return <Badge variant="success">Synced</Badge>;
  if (status === "error") return <Badge variant="danger">Sync problem</Badge>;
  return <Badge variant="muted">Not synced yet</Badge>;
}

/**
 * Airbnb calendar sync for one unit: the feed we read (import) and the feed
 * Airbnb reads from us (export).
 */
export function ChannelSync(props: ChannelSyncProps) {
  const [state, save] = useActionState<SyncActionState, FormData>(
    saveAirbnbLink.bind(null, props.unitId),
    {}
  );
  const [syncing, startSync] = useTransition();
  const [regenerating, startRegenerate] = useTransition();
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);

  const run = (fn: () => Promise<SyncActionState>) => async () => {
    const result = await fn();
    if (result.success) toast.success(result.success);
    if (result.error) toast.error(result.error);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(props.exportUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="mb-5">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Airbnb calendar sync</CardTitle>
        <div className="flex items-center gap-2">
          <SyncStatusBadge status={props.airbnbUrl ? props.status : null} />
          {props.canManage && props.airbnbUrl && (
            <Button
              size="sm"
              variant="outline"
              disabled={syncing}
              onClick={() => startSync(run(() => syncUnitNow(props.unitId)))}
            >
              <RefreshCw className={syncing ? "size-4 animate-spin" : "size-4"} />
              {syncing ? "Syncing…" : "Sync now"}
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {props.flaggedCount > 0 && (
          <div className="flex gap-2 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-3 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
            <p>
              <span className="font-medium">
                {props.flaggedCount} upcoming Airbnb {props.flaggedCount === 1 ? "stay was" : "stays were"} imported
                without a valid DET permit.
              </span>{" "}
              They are recorded so the dates stay blocked, but the unit must not host
              short-term guests without a permit. Add or renew it on the DET permits tab.
            </p>
          </div>
        )}

        <section>
          <h4 className="text-sm font-medium">Import from Airbnb</h4>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Checked every 15 minutes. New Airbnb reservations appear as bookings; ones
            that disappear from Airbnb are cancelled here.
          </p>

          {props.airbnbUrl && (
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
              <Label htmlFor="airbnbIcalUrl">Airbnb calendar link</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="airbnbIcalUrl"
                  name="airbnbIcalUrl"
                  type="url"
                  defaultValue={props.airbnbUrl ?? ""}
                  placeholder="https://www.airbnb.com/calendar/ical/12345678.ics?s=…"
                  className="font-mono text-xs"
                />
                <SaveButton />
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                On Airbnb: the listing&apos;s Calendar → Availability → Connect calendars →
                Export calendar. Leave empty and save to stop syncing.
              </p>
            </form>
          ) : (
            !props.airbnbUrl && (
              <p className="mt-3 text-sm text-[var(--muted-foreground)]">No Airbnb link set.</p>
            )
          )}
        </section>

        <section className="border-t border-[var(--border)] pt-5">
          <h4 className="text-sm font-medium">Export to Airbnb</h4>
          <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
            Paste this link into Airbnb (Connect calendars → Import calendar) so Airbnb
            blocks the nights of direct and other-channel bookings, owner stays and
            maintenance. It shows dates only - never guest names or prices. Keep it
            private.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <Input readOnly value={props.exportUrl} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button type="button" size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            {props.canManage && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={regenerating}
                onClick={() => {
                  if (
                    window.confirm(
                      "Create a new export link? The current one stops working immediately and must be replaced in Airbnb."
                    )
                  ) {
                    startRegenerate(run(() => regenerateExportLink(props.unitId)));
                  }
                }}
              >
                <RotateCcw className="size-4" />
                New link
              </Button>
            )}
          </div>
        </section>
      </CardContent>
    </Card>
  );
}
