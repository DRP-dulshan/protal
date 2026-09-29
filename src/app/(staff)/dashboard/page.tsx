import Link from "next/link";
import {
  Building2,
  DoorOpen,
  TrendingUp,
  ShieldAlert,
  Wrench,
  CalendarClock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/domain/shared";
import { ComplianceBadge, MaintenanceStatusBadge } from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, rollingWindow } from "@/lib/dates";
import { COMPLIANCE_KIND } from "@/lib/labels";
import { formatAED } from "@/lib/money";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();
  // Rolling window, not calendar month: on the 1st a month-to-date figure
  // is empty and tells the reader nothing.
  const { start, end } = rollingWindow(30);

  // Every query below runs as the signed-in user, so a property manager sees
  // only their assigned buildings without any extra filtering here.
  // The profile check travels in the same batch as the data: RLS already
  // guards every query, so waiting for the profile first would only add a
  // full round trip to the database region.
  const [profile, unitsResult, complianceResult, ledgerResult, maintenanceResult] =
    await Promise.all([
      requireProfile(),
      supabase
        .from("v_units_overview")
        .select("id, status, operating_mode, property_name, unit_number, has_valid_permit")
        .eq("is_active", true),

      supabase
        .from("v_compliance_status")
        .select("kind, label, due_date, days_remaining, severity, unit_id")
        .neq("severity", "ok")
        .order("days_remaining", { ascending: true })
        .limit(8),

      supabase
        .from("ledger_entries")
        .select("direction, amount_aed, vat_amount_aed")
        .gte("entry_date", start)
        .lte("entry_date", end),

      supabase
        .from("maintenance_requests")
        .select("id, ticket_number, title, status, priority, reported_at, unit_id")
        .not("status", "in", "(closed,cancelled,rejected)")
        .order("reported_at", { ascending: false })
        .limit(5),
    ]);

  const units = unitsResult.data ?? [];
  const compliance = complianceResult.data ?? [];
  const ledger = ledgerResult.data ?? [];
  const tickets = can(profile.role, "maintenance.view") ? (maintenanceResult.data ?? []) : [];

  const totalUnits = units.length;
  const occupied = units.filter((u) => u.status === "occupied_long_term").length;
  const listedShort = units.filter((u) => u.status === "listed_short_term").length;
  const vacant = units.filter((u) => u.status === "vacant").length;
  const occupancyRate = totalUnits ? Math.round(((occupied + listedShort) / totalUnits) * 100) : 0;

  const income = ledger
    .filter((e) => e.direction === "income")
    .reduce((sum, e) => sum + Number(e.amount_aed ?? 0), 0);
  const expenses = ledger
    .filter((e) => e.direction === "expense")
    .reduce((sum, e) => sum + Number(e.amount_aed ?? 0) + Number(e.vat_amount_aed ?? 0), 0);

  const breaches = compliance.filter(
    (c) => c.severity === "overdue" || c.severity === "urgent"
  ).length;

  // Short-term units listed without a live DET permit are an immediate
  // regulatory exposure, so they get called out rather than buried in a list.
  const permitGaps = units.filter(
    (u) =>
      (u.operating_mode === "short_term" || u.operating_mode === "both") &&
      !u.has_valid_permit
  );

  const showFinance = can(profile.role, "finance.view");

  return (
    <>
      <PageHeader
        title={`Good day, ${(profile.full_name || "there").split(" ")[0]}`}
        description="Portfolio health, compliance exposure and the last 30 days."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Units under management"
          value={totalUnits}
          sublabel={`${occupied} leased · ${listedShort} short-term · ${vacant} vacant`}
          icon={<DoorOpen className="size-5" />}
          href="/units"
        />
        <StatCard
          label="Occupancy"
          value={`${occupancyRate}%`}
          sublabel="Long-term and short-term combined"
          icon={<TrendingUp className="size-5" />}
          tone={occupancyRate >= 85 ? "success" : occupancyRate >= 70 ? "warning" : "danger"}
        />
        {showFinance ? (
          <StatCard
            label="Income · last 30 days"
            value={formatAED(income, { decimals: false })}
            sublabel={`Expenses ${formatAED(expenses, { decimals: false })}`}
            icon={<Building2 className="size-5" />}
            tone="brand"
            href="/finance"
          />
        ) : (
          <StatCard
            label="Open tickets"
            value={tickets.length}
            sublabel="Maintenance awaiting action"
            icon={<Wrench className="size-5" />}
          />
        )}
        <StatCard
          label="Compliance breaches"
          value={breaches}
          sublabel={breaches === 0 ? "Nothing urgent" : "Urgent or overdue"}
          icon={<ShieldAlert className="size-5" />}
          tone={breaches === 0 ? "success" : "danger"}
          href="/compliance"
        />
      </div>

      {permitGaps.length > 0 && (
        <Card className="mt-6 border-[var(--destructive)]/40 bg-[var(--destructive)]/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-[var(--destructive)]" />
              <div className="min-w-0">
                <p className="font-medium">
                  {permitGaps.length} short-term{" "}
                  {permitGaps.length === 1 ? "unit has" : "units have"} no valid DET
                  permit
                </p>
                <p className="mt-0.5 text-sm text-[var(--muted-foreground)]">
                  These units cannot be listed or booked until a permit is on file.{" "}
                  {permitGaps
                    .slice(0, 3)
                    .map((u) => `${u.property_name} ${u.unit_number}`)
                    .join(", ")}
                  {permitGaps.length > 3 && ` and ${permitGaps.length - 3} more`}.
                </p>
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link href="/units?permit=missing">Review these units</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" />
              Expiring soon
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/compliance">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {compliance.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="Nothing expiring"
                  description="Every Ejari registration, DET permit and management agreement is current."
                />
              </div>
            ) : (
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
                    <TableRow key={`${item.kind}-${i}`}>
                      <TableCell>
                        <p className="truncate font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {item.kind ? COMPLIANCE_KIND[item.kind] : "—"}
                        </p>
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap text-sm">
                        {formatDate(item.due_date)}
                      </TableCell>
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
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4" />
              Open maintenance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {tickets.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No open tickets"
                  description="Maintenance requests raised by tenants, guests or owners appear here."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Raised</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.map((ticket) => (
                    <TableRow key={ticket.id}>
                      <TableCell>
                        <p className="truncate font-medium">{ticket.title}</p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {ticket.ticket_number}
                        </p>
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap text-sm">
                        {formatDate(ticket.reported_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <MaintenanceStatusBadge status={ticket.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {showFinance && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Last 30 days at a glance</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Collected income
              </p>
              <Money amount={income} className="mt-1 block text-lg font-semibold" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Expenses (incl. VAT)
              </p>
              <Money amount={expenses} className="mt-1 block text-lg font-semibold" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Net position
              </p>
              <Money
                amount={income - expenses}
                className="mt-1 block text-lg font-semibold"
              />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                Ledger entries
              </p>
              <p className="tabular mt-1 text-lg font-semibold">{ledger.length}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}
