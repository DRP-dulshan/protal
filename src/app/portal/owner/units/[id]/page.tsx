import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getPortalSettings } from "@/lib/auth/session";
import { PageHeader, EmptyState, Field, FieldGrid } from "@/components/domain/shared";
import { UnitStatusBadge } from "@/components/domain/status-badge";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { addDays, dubaiToday, monthGrid, parseMonth } from "@/lib/calendar";
import { formatDate } from "@/lib/dates";
import { UNIT_KIND } from "@/lib/labels";
import { OwnerBookingsTable } from "../../owner-bookings-table";

export const metadata = { title: "Property calendar" };

export default async function OwnerUnitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const { id } = await params;
  const { month: monthParam } = await searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const month = parseMonth(monthParam);
  const grid = monthGrid(month);
  const gridStart = grid[0][0];
  const gridEnd = addDays(grid.at(-1)!.at(-1)!, 1);
  const today = dubaiToday();

  const supabase = await createClient();

  // All three are owner-safe views: a unit that is not the caller's simply
  // returns no row, so there is no ownership check to get wrong here.
  const [, settings, unitResult, calendarResult, blocksResult, listResult] = await Promise.all([
    requireRole(["owner"]),
    getPortalSettings(),
    supabase.from("owner_units_view").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("owner_bookings_view")
      .select("id, check_in, check_out, source, guest_first_name")
      .eq("unit_id", id)
      .lt("check_in", gridEnd)
      .gt("check_out", gridStart),
    supabase
      .from("owner_calendar_blocks_view")
      .select("*")
      .eq("unit_id", id)
      .lt("start_date", gridEnd)
      .gt("end_date", gridStart),
    supabase
      .from("owner_bookings_view")
      .select("*")
      .eq("unit_id", id)
      .gte("check_out", addDays(today, -90))
      .order("check_in", { ascending: false })
      .limit(50),
  ]);

  const unit = unitResult.data;
  if (!unit) notFound();

  const showGuestName = settings?.show_guest_first_name_to_owners ?? false;
  const stays = (calendarResult.data ?? []).map((b) => ({
    id: b.id!,
    checkIn: b.check_in!,
    checkOut: b.check_out!,
    source: b.source!,
    label: showGuestName ? b.guest_first_name : null,
  }));
  const blocks = (blocksResult.data ?? []).map((b) => ({
    id: b.id!,
    start: b.start_date!,
    end: b.end_date!,
    reason: b.reason!,
  }));
  const bookings = listResult.data ?? [];
  const upcoming = bookings.filter((b) => b.check_out! > today).reverse();
  const recent = bookings.filter((b) => b.check_out! <= today);

  return (
    <>
      <PageHeader
        title={`${unit.property_name} · ${unit.unit_number}`}
        description={[unit.community_name, unit.kind && UNIT_KIND[unit.kind]].filter(Boolean).join(" · ")}
        breadcrumb={[{ label: "My properties", href: "/portal/owner/units" }, { label: unit.unit_number ?? "" }]}
        actions={unit.status ? <UnitStatusBadge status={unit.status} /> : undefined}
      />

      <Card className="mb-6">
        <CardContent className="p-5">
          <FieldGrid columns={4}>
            <Field label="Bedrooms">
              {Number(unit.bedrooms) === 0 ? "Studio" : (unit.bedrooms ?? "—")}
            </Field>
            <Field label="Bathrooms">{unit.bathrooms ?? "—"}</Field>
            <Field label="Max guests">{unit.max_guests ?? "—"}</Field>
            <Field label="DET permit">
              {unit.det_permit_number
                ? `${unit.det_permit_number} · to ${formatDate(unit.det_permit_expiry)}`
                : "—"}
            </Field>
          </FieldGrid>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardContent className="p-4 sm:p-5">
          <BookingCalendar
            month={month}
            stays={stays}
            blocks={blocks}
            monthHref={(m) => `/portal/owner/units/${id}?month=${m}`}
          />
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Upcoming stays</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No upcoming stays" />
            </div>
          ) : (
            <OwnerBookingsTable bookings={upcoming} showProperty={false} showGuestName={showGuestName} />
          )}
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent stays (last 90 days)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <OwnerBookingsTable bookings={recent} showProperty={false} showGuestName={showGuestName} />
          </CardContent>
        </Card>
      )}
    </>
  );
}
