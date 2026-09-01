import Link from "next/link";
import { Building2, Wallet, ShieldCheck, Wrench, FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader, StatCard, EmptyState, Money } from "@/components/domain/shared";
import {
  UnitStatusBadge,
  StatementStatusBadge,
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
import { formatDate, formatMonth } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { COMPLIANCE_KIND } from "@/lib/labels";

export const metadata = { title: "My portfolio" };

export default async function OwnerPortalPage() {
  const profile = await requireRole(["owner"]);
  const supabase = await createClient();

  // RLS scopes all of this to the units this login actually owns; no filtering
  // by owner id is needed or trusted here.
  const [unitsResult, statementsResult, complianceResult, maintenanceResult] =
    await Promise.all([
      supabase.from("v_units_overview").select("*").eq("is_active", true),
      supabase
        .from("owner_statements")
        .select("*")
        .in("status", ["issued", "approved", "paid"])
        .order("period_start", { ascending: false })
        .limit(6),
      supabase
        .from("v_compliance_status")
        .select("*")
        .neq("severity", "ok")
        .order("days_remaining")
        .limit(6),
      supabase
        .from("maintenance_requests")
        .select("id, ticket_number, title, status, quoted_amount_aed, owner_approval_required, owner_approved_at, unit_id")
        .not("status", "in", "(closed,cancelled,rejected)")
        .order("reported_at", { ascending: false })
        .limit(6),
    ]);

  const units = unitsResult.data ?? [];
  const statements = statementsResult.data ?? [];
  const compliance = complianceResult.data ?? [];
  const tickets = maintenanceResult.data ?? [];

  const occupied = units.filter(
    (u) => u.status === "occupied_long_term" || u.status === "listed_short_term"
  ).length;
  const occupancy = units.length ? Math.round((occupied / units.length) * 100) : 0;

  const thisYear = new Date().getFullYear();
  const ytdPayout = statements
    .filter((s) => new Date(s.period_start).getFullYear() === thisYear)
    .reduce((sum, s) => sum + Number(s.net_payout_aed), 0);

  const awaitingApproval = tickets.filter(
    (t) => t.owner_approval_required && !t.owner_approved_at
  );

  return (
    <>
      <PageHeader
        title={`Welcome, ${(profile.full_name || "Owner").split(" ")[0]}`}
        description="Your properties, income and anything waiting on you."
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
          sublabel={`${occupied} generating income`}
          icon={<Building2 className="size-5" />}
          href="/portal/owner/units"
        />
        <StatCard
          label="Occupancy"
          value={`${occupancy}%`}
          tone={occupancy >= 85 ? "success" : occupancy >= 60 ? "warning" : "danger"}
        />
        <StatCard
          label="Paid out this year"
          value={formatAED(ytdPayout, { decimals: false })}
          sublabel="Net of fees and expenses"
          icon={<Wallet className="size-5" />}
          tone="brand"
          href="/portal/owner/statements"
        />
        <StatCard
          label="Compliance"
          value={compliance.length === 0 ? "Clear" : compliance.length}
          sublabel={compliance.length === 0 ? "Everything current" : "Items need attention"}
          icon={<ShieldCheck className="size-5" />}
          tone={compliance.length === 0 ? "success" : "warning"}
        />
      </div>

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
                    <TableHead className="text-right">Rent</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.slice(0, 6).map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell>
                        <p className="truncate font-medium">
                          {unit.property_name} · {unit.unit_number}
                        </p>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {unit.bedrooms} bed
                          {unit.lease_end_date &&
                            ` · lease ends ${formatDate(unit.lease_end_date)}`}
                        </p>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money
                          amount={unit.annual_rent_aed ?? unit.target_annual_rent_aed}
                          compact
                        />
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

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4" />
              Recent statements
            </CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/portal/owner/statements">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {statements.length === 0 ? (
              <div className="p-5">
                <EmptyState
                  title="No statements yet"
                  description="Your monthly statement appears here once it has been issued."
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead className="text-right">Net payout</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {statements.map((statement) => (
                    <TableRow key={statement.id}>
                      <TableCell>
                        <Link
                          href={`/portal/owner/statements/${statement.id}`}
                          className="font-medium hover:underline"
                        >
                          {formatMonth(statement.period_start)}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {statement.statement_number}
                        </p>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money amount={statement.net_payout_aed} />
                      </TableCell>
                      <TableCell className="text-right">
                        <StatementStatusBadge status={statement.status} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {compliance.length > 0 && (
        <Card className="mt-6">
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
                    <TableCell className="tabular text-sm">
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
          </CardContent>
        </Card>
      )}

      {tickets.length > 0 && (
        <Card className="mt-6">
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
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {ticket.ticket_number}
                      </p>
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
      )}
    </>
  );
}
