import Link from "next/link";
import { BedDouble, CalendarDays, LogIn, LogOut, Plus, Search, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { Callout, PageHeader, EmptyState, Money, StatCard } from "@/components/domain/shared";
import { BookingStatusBadge, ChannelBadge } from "@/components/domain/status-badge";
import { ExportButton } from "@/components/domain/export-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  ROW_LINK,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { dubaiToday } from "@/lib/calendar";
import { BOOKING_STATUS, SALES_CHANNEL } from "@/lib/labels";

export const metadata = { title: "Bookings" };

const VIEWS = {
  upcoming: "Upcoming and in-house",
  past: "Past stays",
  cancelled: "Cancelled and no-shows",
  needs_price: "Needs a price",
  all: "All bookings",
} as const;
type View = keyof typeof VIEWS;

const LIVE = ["inquiry", "tentative", "confirmed", "checked_in"] as const;
/** Stays that happen or happened, i.e. that should have a price. */
const PRICED = ["tentative", "confirmed", "checked_in", "checked_out"] as const;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; unit?: string }>;
}) {
  const params = await searchParams;
  const view: View = params.view && params.view in VIEWS ? (params.view as View) : "upcoming";
  const today = dubaiToday();
  const supabase = await createClient();

  let query = supabase
    .from("bookings")
    .select("*, guests(full_name, phone), units(id, unit_number, properties(name))");

  if (view === "upcoming") {
    query = query.in("status", [...LIVE]).gte("check_out", today).order("check_in");
  } else if (view === "past") {
    query = query
      .in("status", ["checked_out", "checked_in", "confirmed"])
      .lt("check_out", today)
      .order("check_in", { ascending: false });
  } else if (view === "needs_price") {
    query = query.in("status", [...PRICED]).eq("gross_total_aed", 0).order("check_in");
  } else if (view === "cancelled") {
    query = query.in("status", ["cancelled", "no_show"]).order("check_in", { ascending: false });
  } else {
    query = query.order("check_in", { ascending: false });
  }
  if (params.unit && /^[0-9a-f-]{36}$/i.test(params.unit)) query = query.eq("unit_id", params.unit);
  if (params.q) {
    const term = params.q.replace(/[%,()]/g, "");
    query = query.or(`booking_number.ilike.%${term}%,external_booking_id.ilike.%${term}%`);
  }

  const [profile, { data, error }, unitsResult, unpricedResult, todayResult] = await Promise.all([
    requireCapability("bookings.view"),
    query.limit(500),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name")
      .eq("is_active", true)
      .in("operating_mode", ["short_term", "both"])
      .order("property_name"),
    // Stays still waiting for a price (Airbnb imports arrive without one).
    supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .in("status", [...PRICED])
      .eq("gross_total_aed", 0),
    // Today's movements, whatever the filter.
    supabase
      .from("bookings")
      .select("status, check_in, check_out")
      .in("status", ["confirmed", "checked_in"])
      .lte("check_in", today)
      .gte("check_out", today),
  ]);

  const bookings = data ?? [];
  const movements = todayResult.data ?? [];
  const arriving = movements.filter((b) => b.check_in === today && b.status === "confirmed").length;
  const departing = movements.filter((b) => b.check_out === today && b.status === "checked_in").length;
  const inHouse = movements.filter((b) => b.status === "checked_in" && b.check_out > today).length;
  const canManage = can(profile.role, "bookings.manage");
  const unpriced = unpricedResult.count ?? 0;

  const exportRows = bookings.map((b) => ({
    Booking: b.booking_number,
    Unit: `${b.units?.properties?.name ?? ""} ${b.units?.unit_number ?? ""}`.trim(),
    Guest: b.guests?.full_name ?? "",
    Channel: SALES_CHANNEL[b.channel],
    "Channel ref": b.external_booking_id ?? "",
    "Check-in": b.check_in,
    "Check-out": b.check_out,
    Nights: b.nights ?? "",
    Status: BOOKING_STATUS[b.status],
    "Payout (AED)": b.payout_expected_aed ?? b.gross_total_aed,
    "Guest paid (AED)": b.gross_total_aed,
  }));

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Holiday home stays across every channel."
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-bookings" />
            {canManage && (
              <Button asChild variant="outline">
                <Link href="/bookings/import">
                  <Upload className="size-4" />
                  Import Airbnb earnings
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild>
                <Link href="/bookings/new">
                  <Plus className="size-4" />
                  New booking
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Arriving today" value={arriving} icon={<LogIn className="size-4" />} />
        <StatCard label="Departing today" value={departing} icon={<LogOut className="size-4" />} />
        <StatCard label="In house" value={inHouse} icon={<BedDouble className="size-4" />} />
      </div>

      {unpriced > 0 && view !== "needs_price" && (
        <div className="mb-4">
          <Callout
            tone="warning"
            title={`${unpriced} ${unpriced === 1 ? "stay has" : "stays have"} no price yet`}
          >
            Airbnb stays arrive from the calendar with dates only.{" "}
            <Link href="/bookings?view=needs_price" className="underline underline-offset-2">
              See them
            </Link>
            {canManage && (
              <>
                {" "}or{" "}
                <Link href="/bookings/import" className="underline underline-offset-2">
                  import Airbnb&apos;s earnings CSV
                </Link>{" "}
                to price them all at once
              </>
            )}
            .
          </Callout>
        </div>
      )}

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Booking number or channel reference"
                className="pl-8"
              />
            </div>
            <Select name="unit" defaultValue={params.unit ?? ""} className="sm:w-56">
              <option value="">All holiday home units</option>
              {(unitsResult.data ?? []).map((u) => (
                <option key={u.id!} value={u.id!}>
                  {u.property_name} · {u.unit_number}
                </option>
              ))}
            </Select>
            <Select name="view" defaultValue={view} className="sm:w-52">
              {Object.entries(VIEWS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState
          title="Could not load bookings"
          description={error.message}
          icon={<CalendarDays className="size-8" />}
        />
      ) : bookings.length === 0 ? (
        <EmptyState
          title="No bookings here"
          description={
            view === "upcoming"
              ? "No upcoming stays. Add a booking, or change the filter to see past stays."
              : "Nothing matches these filters."
          }
          icon={<CalendarDays className="size-8" />}
          action={
            canManage ? (
              <Button asChild>
                <Link href="/bookings/new">New booking</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Booking</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Guest</TableHead>
                <TableHead>Stay</TableHead>
                <TableHead className="hidden lg:table-cell">Channel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Payout</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bookings.map((b) => (
                <TableRow key={b.id} className="relative cursor-pointer">
                  <TableCell>
                    <Link href={`/bookings/${b.id}`} className={ROW_LINK}>
                      {b.booking_number}
                    </Link>
                    {b.external_booking_id && (
                      <p className="text-xs text-[var(--muted-foreground)]">{b.external_booking_id}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {b.units?.properties?.name} · {b.units?.unit_number}
                  </TableCell>
                  <TableCell className="hidden text-sm md:table-cell">
                    {b.guests?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="tabular whitespace-nowrap text-sm">
                    {formatDate(b.check_in)} → {formatDate(b.check_out)}
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {b.nights} night{b.nights === 1 ? "" : "s"}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    <ChannelBadge channel={b.channel} />
                  </TableCell>
                  <TableCell>
                    <BookingStatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="hidden text-right sm:table-cell">
                    {Number(b.gross_total_aed) === 0 && b.status !== "cancelled" && b.status !== "no_show" ? (
                      <span className="text-xs text-[var(--warning)]">No price yet</span>
                    ) : (
                      // What D|R|P receives: Airbnb's "Amount" for imported stays.
                      <Money amount={b.payout_expected_aed ?? b.gross_total_aed} />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
