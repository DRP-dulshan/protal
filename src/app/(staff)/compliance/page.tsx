import Link from "next/link";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { PageHeader, StatCard, EmptyState } from "@/components/domain/shared";
import { ComplianceBadge } from "@/components/domain/status-badge";
import { ExportButton } from "@/components/domain/export-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { COMPLIANCE_KIND, parseEnum } from "@/lib/labels";

export const metadata = { title: "Compliance" };

/** Where each compliance item is actioned. */
const LINK_FOR: Record<string, (entityId: string, unitId: string | null) => string> = {
  ejari_expiry: (id) => `/leases/${id}`,
  ejari_occupant_declaration: (id) => `/leases/${id}`,
  lease_expiry: (id) => `/leases/${id}`,
  det_permit_expiry: (_id, unitId) => (unitId ? `/units/${unitId}` : "/permits"),
  building_noc_expiry: (_id, unitId) => (unitId ? `/units/${unitId}` : "/permits"),
  management_agreement_expiry: (_id, unitId) =>
    unitId ? `/units/${unitId}` : "/owners",
  preventive_maintenance: (_id, unitId) => (unitId ? `/units/${unitId}` : "/maintenance"),
};

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; severity?: string }>;
}) {
  await requireCapability("compliance.view");
  const params = await searchParams;
  const supabase = await createClient();
  const settings = await getCompanySettings();

  let query = supabase
    .from("v_compliance_status")
    .select("*")
    .order("days_remaining", { ascending: true });

  const kind = parseEnum(COMPLIANCE_KIND, params.kind);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  const all = data ?? [];

  const filtered = params.severity
    ? all.filter((i) => i.severity === params.severity)
    : all;

  const counts = {
    overdue: all.filter((i) => i.severity === "overdue").length,
    urgent: all.filter((i) => i.severity === "urgent").length,
    dueSoon: all.filter((i) => i.severity === "due_soon").length,
    ok: all.filter((i) => i.severity === "ok").length,
  };

  // A single number the managing director can be held to: what share of
  // tracked obligations are currently in good standing.
  const tracked = all.length;
  const healthy = counts.ok;
  const healthScore = tracked ? Math.round((healthy / tracked) * 100) : 100;

  const alertDays = settings?.document_alert_days ?? [60, 30, 7];

  const exportRows = filtered.map((i) => ({
    Type: i.kind ? COMPLIANCE_KIND[i.kind] : "",
    Item: i.label ?? "",
    "Due date": i.due_date ?? "",
    "Days remaining": i.days_remaining ?? "",
    Severity: i.severity ?? "",
  }));

  return (
    <>
      <PageHeader
        title="Compliance calendar"
        description={`Every Ejari registration, DET permit, NOC, management agreement, insurance policy and ID expiry in one place. Alerts fire at ${alertDays.join("/")} days.`}
        actions={<ExportButton rows={exportRows} filename="drp-compliance" />}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Compliance health"
          value={`${healthScore}%`}
          sublabel={`${healthy} of ${tracked} obligations current`}
          tone={healthScore >= 95 ? "success" : healthScore >= 80 ? "warning" : "danger"}
          icon={<ShieldCheck className="size-5" />}
        />
        <StatCard
          label="Overdue"
          value={counts.overdue}
          sublabel="Past the deadline"
          tone={counts.overdue > 0 ? "danger" : "success"}
          href="/compliance?severity=overdue"
        />
        <StatCard
          label="Urgent"
          value={counts.urgent}
          sublabel="Within 7 days"
          tone={counts.urgent > 0 ? "danger" : "success"}
          href="/compliance?severity=urgent"
        />
        <StatCard
          label="Due soon"
          value={counts.dueSoon}
          sublabel="Within 60 days"
          tone={counts.dueSoon > 0 ? "warning" : "success"}
          href="/compliance?severity=due_soon"
        />
      </div>

      <Card className="my-5">
        <CardContent className="p-3">
          <form className="flex flex-col gap-2 sm:flex-row">
            <Select name="kind" defaultValue={params.kind ?? ""} className="sm:w-64">
              <option value="">All obligation types</option>
              {Object.entries(COMPLIANCE_KIND).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select
              name="severity"
              defaultValue={params.severity ?? ""}
              className="sm:w-48"
            >
              <option value="">All statuses</option>
              <option value="overdue">Overdue</option>
              <option value="urgent">Urgent</option>
              <option value="due_soon">Due soon</option>
              <option value="ok">Current</option>
            </Select>
            <Button type="submit" variant="secondary">
              Filter
            </Button>
            {(params.kind || params.severity) && (
              <Button asChild variant="ghost">
                <Link href="/compliance">Clear</Link>
              </Button>
            )}
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" />
            Renewal calendar ({filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="p-5">
              <EmptyState title="Could not load compliance data" description={error.message} />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nothing to action"
                description="No obligation matches these filters."
                icon={<ShieldCheck className="size-8" />}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Obligation</TableHead>
                  <TableHead className="hidden md:table-cell">Type</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item, i) => {
                  const href =
                    item.kind && item.entity_id
                      ? LINK_FOR[item.kind]?.(item.entity_id, item.unit_id)
                      : undefined;

                  return (
                    <TableRow key={`${item.kind}-${item.entity_id}-${i}`}>
                      <TableCell>
                        {href ? (
                          <Link href={href} className="font-medium hover:underline">
                            {item.label}
                          </Link>
                        ) : (
                          <span className="font-medium">{item.label}</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-[var(--muted-foreground)]">
                        {item.kind ? COMPLIANCE_KIND[item.kind] : "—"}
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
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
