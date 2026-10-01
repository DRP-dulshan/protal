import Link from "next/link";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Callout } from "@/components/domain/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { dubaiToday } from "@/lib/calendar";
import { SyncStatusBadge } from "../units/[id]/channel-sync";
import { SyncAllButton } from "./sync-all-button";
import { FEED_CHANNEL_NAME, type FeedChannel } from "@/lib/ical/url";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar sync" };

const dubaiTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Dubai",
  dateStyle: "medium",
  timeStyle: "short",
});

/** Sync status of every holiday-home unit's calendar, one channel at a time. */
export default async function CalendarSyncPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const channel: FeedChannel = (await searchParams).channel === "booking_com" ? "booking_com" : "airbnb";
  const site = FEED_CHANNEL_NAME[channel];
  const supabase = await createClient();
  const today = dubaiToday();

  const [profile, unitsResult, permitsResult, flaggedResult] = await Promise.all([
    requireCapability("bookings.view"),
    supabase
      .from("units")
      .select(
        "id, unit_number, airbnb_ical_url, ical_last_synced_at, ical_last_status, ical_last_error, ical_last_event_count, booking_ical_url, booking_ical_last_synced_at, booking_ical_last_status, booking_ical_last_error, booking_ical_last_event_count, properties(name)"
      )
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("unit_number"),
    supabase.from("v_units_overview").select("id, has_valid_permit, owner_name").eq("is_active", true),
    supabase
      .from("bookings")
      .select("unit_id")
      .eq("imported_without_permit", true)
      .eq("channel", channel)
      .in("status", ["confirmed", "checked_in"])
      .gt("check_out", today),
  ]);

  const permitted = new Map((permitsResult.data ?? []).map((u) => [u.id, u.has_valid_permit]));
  const ownerOf = new Map((permitsResult.data ?? []).map((u) => [u.id, u.owner_name]));
  const flagged = new Map<string, number>();
  for (const b of flaggedResult.data ?? []) flagged.set(b.unit_id, (flagged.get(b.unit_id) ?? 0) + 1);

  // One shape for either channel's feed columns.
  const units = (unitsResult.data ?? [])
    .map((u) => ({
      id: u.id,
      unit_number: u.unit_number,
      properties: u.properties,
      url: channel === "airbnb" ? u.airbnb_ical_url : u.booking_ical_url,
      syncedAt: channel === "airbnb" ? u.ical_last_synced_at : u.booking_ical_last_synced_at,
      status: channel === "airbnb" ? u.ical_last_status : u.booking_ical_last_status,
      error: channel === "airbnb" ? u.ical_last_error : u.booking_ical_last_error,
      events: channel === "airbnb" ? u.ical_last_event_count : u.booking_ical_last_event_count,
    }))
    .sort((a, b) =>
      `${a.properties?.name} ${a.unit_number}`.localeCompare(`${b.properties?.name} ${b.unit_number}`)
    );
  const linked = units.filter((u) => u.url);
  const problems = linked.filter((u) => u.status === "error").length;
  const canManage = can(profile.role, "bookings.manage");
  const canAdd = can(profile.role, "properties.manage");
  const addButton = canAdd ? (
    <Button asChild variant={linked.length > 0 ? "outline" : "default"}>
      <Link href={channel === "airbnb" ? "/calendar-sync/add" : "/calendar-sync/add?channel=booking_com"}>
        <Plus className="size-4" />
        Add {site} listings
      </Link>
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Calendar sync"
        description="Airbnb and Booking.com calendars are imported every 15 minutes, each on its own."
        actions={
          <>
            {addButton}
            {canManage && linked.length > 0 && <SyncAllButton />}
          </>
        }
      />

      <nav className="mb-4 flex gap-2" aria-label="Channel">
        {(["airbnb", "booking_com"] as const).map((c) => (
          <Link
            key={c}
            href={c === "airbnb" ? "/calendar-sync" : "/calendar-sync?channel=booking_com"}
            aria-current={c === channel ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium",
              c === channel
                ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                : "bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            )}
          >
            {FEED_CHANNEL_NAME[c]}
          </Link>
        ))}
      </nav>

      {problems > 0 && (
        <div className="mb-4">
          <Callout tone="danger" title={`${problems} ${problems === 1 ? "unit has" : "units have"} a sync problem`}>
            Open the unit to see the message. A clash usually means the same nights
            were booked on another channel or directly as well as on {site}.
          </Callout>
        </div>
      )}

      {units.length === 0 ? (
        <EmptyState
          title="No holiday-home units"
          description={`Add your ${site} listings to bring them in as holiday-home units, with their calendars connected.`}
          icon={<RefreshCw className="size-8" />}
          action={addButton ?? undefined}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unit</TableHead>
                  <TableHead className="hidden md:table-cell">Owner</TableHead>
                  <TableHead>{site} link</TableHead>
                  <TableHead className="hidden sm:table-cell">Last synced</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Events</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {units.map((u) => {
                  const flags = permitted.get(u.id) ? 0 : (flagged.get(u.id) ?? 0);
                  return (
                    <TableRow key={u.id}>
                      <TableCell>
                        <Link href={`/units/${u.id}?tab=calendar`} className="font-medium hover:underline">
                          {u.properties?.name} · {u.unit_number}
                        </Link>
                        {flags > 0 && (
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--warning-foreground)] dark:text-[var(--warning)]">
                            <AlertTriangle className="size-3" />
                            {flags} {site} {flags === 1 ? "stay" : "stays"} without a DET permit
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        {ownerOf.get(u.id) ?? (
                          <Link href={`/units/${u.id}/edit`} className="hover:underline">
                            <Badge variant="warning">No owner</Badge>
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        {u.url ? <Badge variant="default">Connected</Badge> : <Badge variant="muted">Not set</Badge>}
                      </TableCell>
                      <TableCell className="tabular hidden whitespace-nowrap text-sm sm:table-cell">
                        {u.syncedAt ? dubaiTime.format(new Date(u.syncedAt)) : "—"}
                      </TableCell>
                      <TableCell className="tabular hidden text-right sm:table-cell">{u.events ?? "—"}</TableCell>
                      <TableCell className="max-w-xs">
                        {u.url ? <SyncStatusBadge status={u.status} /> : "—"}
                        {u.status === "error" && u.error && (
                          <p className="mt-1 line-clamp-2 text-xs text-[var(--destructive)]">{u.error}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  );
}
