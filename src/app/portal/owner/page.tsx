import Link from "next/link";
import { Building2, CalendarDays, Moon, ShieldCheck, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getPortalSettings } from "@/lib/auth/session";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/domain/shared";
import {
  UnitStatusBadge,
  ComplianceBadge,
  MaintenanceStatusBadge,
} from "@/components/domain/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { addDays, dubaiToday, monthRange, nightsWithin } from "@/lib/calendar";
import { COMPLIANCE_KIND } from "@/lib/labels";
import { OwnerBookingsTable } from "./owner-bookings-table";

export const metadata = { title: "My portfolio" };

/**
 * Owner home. Properties, stays and anything waiting on the owner - and no
 * income, payouts or rates, by design and by database policy: every query
 * here goes through an owner-safe view or a table that carries no revenue.
 */
export default async function OwnerPortalPage() {
  const profile = await requireRole(["owner"]);
  const supabase = await createClient();
  const settings = await getPortalSettings();

  const today = dubaiToday();
  const { start: monthStart, end: monthEnd } = monthRange(today.slice(0, 7));

  const [unitsResult, bookingsResult, complianceResult, maintenanceResult] =
    await Promise.all([
      supabase.from("owner_units_view").select("*").eq("is_active", true).order("property_name"),
      supabase
        .from("owner_bookings_view")
        .select("*")
        .gte("check_out", monthStart)
        .order("check_in"),
      supabase
        .from("v_compliance_status")
        .select("*")
        .neq("severity", "ok")
        .order("days_remaining")
        .limit(6),
      // Quotes are a cost the owner approves, not income, so they stay visible.
      supabase
        .from("maintenance_requests")
        .select("id, ticket_number, title, status, quoted_amount_aed, owner_approval_required, owner_approved_at, owner_rejected_at, unit_id")
        .not("status", "in", "(closed,cancelled,rejected)")
        .order("reported_at", { ascending: false })
        .limit(6),
    ]);

  const units = unitsResult.data ?? [];
  const bookings = bookingsResult.data ?? [];
  const compliance = complianceResult.data ?? [];
  const tickets = maintenanceResult.data ?? [];

  const upcoming = bookings.filter((b) => b.check_out! > today);
  const next30 = upcoming.filter((b) => b.check_in! <= addDays(today, 30));
  const nightsThisMonth = bookings.reduce(
    (sum, b) => sum + nightsWithin(b.check_in!, b.check_out!, monthStart, monthEnd),
    0
  );

  const awaitingApproval = tickets.filter(
    (t) => t.owner_approval_required && !t.owner_approved_at && !t.owner_rejected_at
  );

  return (
    <>
      <PageHeader
        title={`Welcome, ${(profile.full_name || "Owner").split(" ")[0]}`}
        description="Your properties, upcoming stays and anything waiting on you."
      />

      {awaitingApproval.length > 0 && (
        <Card className="mb-5 border-[var(--brand)]/50 bg-[var(--brand)]/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Wrench className="mt-0.5 size-5 shrink-0 text-[var(--brand)]" />
              <div className="min-w-0">
                <p className="font-medium">
                  {awaitingApproval.length} maintenance{" "}
                  {awaitingApproval.length === 1 ? "job needs" : "jobs need"} your
                  approval
                </p>
                <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                  Work will not start until you approve the quote.
                </p>
                <Button asChild size="sm" className="mt-3">
                  <Link href="/portal/owner/maintenance">Review requests</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="My properties"
          value={units.length}
          icon={<Building2 className="size-5" />}
          href="/portal/owner/units"
        />
        <StatCard
          label="Stays in next 30 days"
          value={next30.length}
          icon={<CalendarDays className="size-5" />}
          tone="brand"
          href="/portal/owner/bookings"
        />
        <StatCard
          label="Nights booked this month"
          value={nightsThisMonth}
          icon={<Moon className="size-5" />}
        />
        <StatCard
          label="Compliance"
          value={compliance.length === 0 ? "Clear" : compliance.length}
          sublabel={compliance.length === 0 ? "Everything current" : "Items need attention"}
          icon={<ShieldCheck className="size-5" />}
          tone={compliance.length === 0 ? "success" : "warning"}
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarDays className="size-4" />
            Upcoming stays
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/portal/owner/bookings">View all</Link>
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          {upcoming.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No upcoming stays"
                description="Confirmed bookings on your properties will appear here."
              />
            </div>
          ) : (
            <OwnerBookingsTable
              bookings={upcoming.slice(0, 8)}
              showGuestName={settings?.show_guest_first_name_to_owners ?? false}
            />
          )}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Building2 className="size-4" />
              My properties
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/portal/owner/units">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {units.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No properties linked"
                  description="Your property manager will link your units to this portal."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.slice(0, 6).map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <Link
                          href={`/portal/owner/units/${unit.id}`}
                          className="truncate font-medium hover:underline"
                        >
                          {unit.property_name} · {unit.unit_number}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {Number(unit.bedrooms) === 0 ? "Studio" : `${unit.bedrooms} bed`}
                          {unit.community_name && ` · ${unit.community_name}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        {unit.status && <UnitStatusBadge status={unit.status} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {compliance.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Upcoming renewals</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {compliance.map((item, i) => (
                    <TableRow key={i}>
                      <TableCell>
                        <p className="truncate font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {item.kind ? COMPLIANCE_KIND[item.kind] : ""}
                        </p>
                      </TableCell>
                      <TableCell className="tabular text-sm">{formatDate(item.due_date)}</TableCell>
                      <TableCell className="text-right">
                        <ComplianceBadge
                          severity={item.severity ?? "missing"}
                          daysRemaining={item.days_remaining}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </div>

      {tickets.length > 0 && (
        <div className="mt-6">
          <MaintenanceCard tickets={tickets} />
        </div>
      )}
    </>
  );
}

function MaintenanceCard({
  tickets,
}: {
  tickets: {
    id: string;
    ticket_number: string;
    title: string;
    status: Parameters<typeof MaintenanceStatusBadge>[0]["status"];
    quoted_amount_aed: number | null;
  }[];
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Open maintenance</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href="/portal/owner/maintenance">View all</Link>
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead className="text-right">Quote</TableHead>
              <TableHead className="text-right">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tickets.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell>
                  <p className="truncate font-medium">{ticket.title}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">{ticket.ticket_number}</p>
                </TableCell>
                <TableCell className="text-right">
                  <Money amount={ticket.quoted_amount_aed} />
                </TableCell>
                <TableCell className="text-right">
                  <MaintenanceStatusBadge status={ticket.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
