import Link from "next/link";
import { FileSignature, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState, Money } from "@/components/domain/shared";
import { LeaseStatusBadge, EjariBadge } from "@/components/domain/status-badge";
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
import { formatDate, daysUntil } from "@/lib/dates";
import {
  LEASE_STATUS,
  EJARI_STATUS,
  PAYMENT_METHOD,
  optionsFrom,
  parseEnum,
} from "@/lib/labels";

export const metadata = { title: "Tenancies" };

export default async function LeasesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; ejari?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("leases")
    .select(
      "*, tenants(full_name, phone, email), units(unit_number, properties(name))"
    )
    .order("end_date", { ascending: true });

  const status = parseEnum(LEASE_STATUS, params.status);
  const ejari = parseEnum(EJARI_STATUS, params.ejari);
  if (status) query = query.eq("status", status);
  if (ejari) query = query.eq("ejari_status", ejari);
  if (params.q) {
    query = query.or(
      `lease_number.ilike.%${params.q}%,ejari_contract_number.ilike.%${params.q}%`
    );
  }

  const [profile, { data, error }] = await Promise.all([requireCapability("leases.view"), query]);
  const leases = data ?? [];

  const exportRows = leases.map((l) => ({
    Contract: l.lease_number,
    Property: l.units?.properties?.name ?? "",
    Unit: l.units?.unit_number ?? "",
    Tenant: l.tenants?.full_name ?? "",
    Start: l.start_date,
    End: l.end_date,
    "Annual rent (AED)": l.annual_rent_aed,
    "Deposit (AED)": l.security_deposit_aed,
    Payments: `${l.installment_count} × ${PAYMENT_METHOD[l.payment_method]}`,
    Status: LEASE_STATUS[l.status],
    "Ejari status": EJARI_STATUS[l.ejari_status],
    "Ejari number": l.ejari_contract_number ?? "",
    "Ejari expiry": l.ejari_expiry ?? "",
  }));

  // Contracts inside the standard 90-day renewal notice window.
  const renewalsDue = leases.filter((l) => {
    if (l.status !== "active" && l.status !== "expiring") return false;
    const days = daysUntil(l.end_date);
    return days !== null && days <= 90 && days >= 0;
  }).length;

  return (
    <>
      <PageHeader
        title="Tenancies"
        description={
          renewalsDue > 0
            ? `${leases.length} contracts · ${renewalsDue} inside the 90-day renewal notice window`
            : `${leases.length} contract${leases.length === 1 ? "" : "s"}`
        }
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-tenancies" />
            {can(profile.role, "leases.manage") && (
              <Button asChild>
                <Link href="/leases/new">
                  <Plus className="size-4" />
                  New tenancy
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input
                name="q"
                defaultValue={params.q ?? ""}
                placeholder="Contract or Ejari number"
                className="pl-8"
              />
            </div>
            <Select name="status" defaultValue={params.status ?? ""} className="sm:w-44">
              <option value="">All statuses</option>
              {optionsFrom(LEASE_STATUS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select name="ejari" defaultValue={params.ejari ?? ""} className="sm:w-48">
              <option value="">Any Ejari status</option>
              {optionsFrom(EJARI_STATUS).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
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
        <EmptyState title="Could not load tenancies" description={error.message} />
      ) : leases.length === 0 ? (
        <EmptyState
          title="No tenancies"
          description="Create a tenancy contract to begin tracking rent, Ejari registration and declared occupants."
          icon={<FileSignature className="size-8" />}
          action={
            can(profile.role, "leases.manage") ? (
              <Button asChild>
                <Link href="/leases/new">New tenancy</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="hidden md:table-cell">Tenant</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="hidden lg:table-cell">Ejari</TableHead>
                <TableHead className="text-right">Annual rent</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {leases.map((lease) => {
                const days = daysUntil(lease.end_date);
                const closing =
                  (lease.status === "active" || lease.status === "expiring") &&
                  days !== null &&
                  days <= 90;

                return (
                  <TableRow key={lease.id} className="relative cursor-pointer">
                    <TableCell>
                      <Link
                        href={`/leases/${lease.id}`}
                        className={ROW_LINK}
                      >
                        {lease.lease_number}
                      </Link>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {lease.installment_count} ×{" "}
                        {PAYMENT_METHOD[lease.payment_method].toLowerCase()}
                      </p>
                    </TableCell>
                    <TableCell className="text-sm">
                      {lease.units?.properties?.name} · {lease.units?.unit_number}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {lease.tenants?.full_name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <span className="tabular whitespace-nowrap text-sm">
                        {formatDate(lease.end_date)}
                      </span>
                      {closing && (
                        <p
                          className={
                            days !== null && days <= 30
                              ? "text-xs font-medium text-[var(--destructive)]"
                              : "text-xs text-[var(--warning-foreground)]"
                          }
                        >
                          {days} days — notice window open
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <EjariBadge
                        status={lease.ejari_status}
                        contractNumber={lease.ejari_contract_number}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money amount={lease.annual_rent_aed} compact />
                    </TableCell>
                    <TableCell className="text-right">
                      <LeaseStatusBadge status={lease.status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
