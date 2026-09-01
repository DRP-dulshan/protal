import { FileSignature } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import {
  PageHeader,
  Field,
  FieldGrid,
  Money,
  EmptyState,
  Callout,
} from "@/components/domain/shared";
import { LeaseStatusBadge, InstallmentBadge } from "@/components/domain/status-badge";
import { DocumentList } from "@/components/domain/document-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, daysUntil } from "@/lib/dates";
import { PAYMENT_METHOD } from "@/lib/labels";

export const metadata = { title: "My tenancy" };

export default async function TenantPortalPage() {
  await requireRole(["tenant"]);
  const supabase = await createClient();

  // RLS returns only this tenant's own lease, via tenants.profile_id.
  const { data: leases } = await supabase
    .from("leases")
    .select("*, units(unit_number, dewa_premise_number, properties(name))")
    .order("start_date", { ascending: false });

  const lease = (leases ?? []).find(
    (l) => l.status === "active" || l.status === "expiring"
  );

  if (!lease) {
    return (
      <>
        <PageHeader title="My tenancy" />
        <EmptyState
          title="No active tenancy"
          description="Once your tenancy contract is activated it will appear here, along with your payment schedule and documents."
          icon={<FileSignature className="size-8" />}
        />
      </>
    );
  }

  const [installmentsResult, documentsResult] = await Promise.all([
    supabase
      .from("lease_installments")
      .select("*")
      .eq("lease_id", lease.id)
      .order("installment_no"),
    supabase
      .from("documents")
      .select("*")
      .eq("entity_kind", "lease")
      .eq("entity_id", lease.id)
      .order("created_at", { ascending: false }),
  ]);

  const installments = installmentsResult.data ?? [];
  const documents = documentsResult.data ?? [];

  const nextDue = installments.find(
    (i) => i.status === "scheduled" || i.status === "presented"
  );
  const paid = installments
    .filter((i) => i.status === "cleared")
    .reduce((sum, i) => sum + Number(i.amount_aed), 0);
  const outstanding = installments
    .filter((i) => i.status !== "cleared" && i.status !== "cancelled")
    .reduce((sum, i) => sum + Number(i.amount_aed), 0);

  const daysToExpiry = daysUntil(lease.end_date);

  return (
    <>
      <PageHeader
        title={`${lease.units?.properties?.name} · ${lease.units?.unit_number}`}
        description={`Tenancy ${lease.lease_number}`}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <LeaseStatusBadge status={lease.status} />
      </div>

      {daysToExpiry !== null && daysToExpiry <= 90 && daysToExpiry >= 0 && (
        <div className="mb-5">
          <Callout
            tone="warning"
            title={`Your tenancy ends in ${daysToExpiry} days`}
          >
            Your property manager will be in touch about renewal. Contact them if
            you would like to discuss your intentions early.
          </Callout>
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Annual rent
            </p>
            <Money
              amount={lease.annual_rent_aed}
              className="mt-1 block text-xl font-semibold"
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Paid to date
            </p>
            <Money amount={paid} className="mt-1 block text-xl font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Remaining
            </p>
            <Money amount={outstanding} className="mt-1 block text-xl font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Next payment
            </p>
            <p className="mt-1 text-xl font-semibold">
              {nextDue ? formatDate(nextDue.due_date) : "—"}
            </p>
            {nextDue && (
              <Money amount={nextDue.amount_aed} muted className="text-xs" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Contract</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGrid columns={2}>
              <Field label="Term">
                {formatDate(lease.start_date)} – {formatDate(lease.end_date)}
              </Field>
              <Field label="Payment schedule">
                {lease.installment_count} × {PAYMENT_METHOD[lease.payment_method]}
              </Field>
              <Field label="Security deposit">
                <Money amount={lease.security_deposit_aed} />
              </Field>
              <Field label="Ejari contract">
                {lease.ejari_contract_number ?? "Registration pending"}
              </Field>
              <Field label="DEWA premise">
                {lease.units?.dewa_premise_number ?? "—"}
              </Field>
              <Field label="Move in">{formatDate(lease.move_in_date)}</Field>
            </FieldGrid>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Payment schedule</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {installments.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="tabular text-sm">
                      {item.installment_no}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap text-sm">
                      {formatDate(item.due_date)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money amount={item.amount_aed} />
                    </TableCell>
                    <TableCell className="text-right">
                      <InstallmentBadge status={item.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <div className="mt-5">
        <DocumentList
          documents={documents}
          entityKind="lease"
          entityId={lease.id}
          canUpload={false}
          title="My documents"
        />
      </div>

      <p className="mt-6 text-sm text-[var(--muted-foreground)]">
        Raising maintenance requests from this portal arrives with the tenant
        portal build. For anything urgent, contact your property manager directly.
      </p>
    </>
  );
}
