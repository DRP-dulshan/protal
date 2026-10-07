import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  PageHeader,
  Field,
  FieldGrid,
  Money,
  Callout,
} from "@/components/domain/shared";
import {
  LeaseStatusBadge,
  EjariBadge,
  InstallmentBadge,
} from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocumentList } from "@/components/domain/document-list";
import { OccupantsPanel } from "./occupants-panel";
import { InstallmentActions } from "./installment-actions";
import { formatDate, daysUntil } from "@/lib/dates";
import { PAYMENT_METHOD, DEPOSIT_STATUS } from "@/lib/labels";

/** Shared by the page and its metadata, so the lease is fetched once. */
const getLease = cache(async (id: string) => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leases")
    .select(
      `*,
       tenants(id, full_name, email, phone, whatsapp, nationality, emirates_id, emirates_id_expiry),
       units(id, unit_number, dewa_premise_number, properties(id, name))`
    )
    .eq("id", id)
    .maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getLease(id);
  return { title: data?.lease_number ?? "Tenancy" };
}

export default async function LeaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // One batch: the children are keyed by the lease id from the URL, so they
  // need not wait for the lease row itself.
  const [profile, settings, lease, installmentsResult, occupantsResult, documentsResult, depositsResult] =
    await Promise.all([
      requireCapability("leases.view"),
      getCompanySettings(),
      getLease(id),
      supabase
        .from("lease_installments")
        .select("*")
        .eq("lease_id", id)
        .order("installment_no"),
      supabase
        .from("lease_occupants")
        .select("*")
        .eq("lease_id", id)
        .is("removed_on", null)
        .order("is_primary", { ascending: false })
        .order("full_name"),
      supabase
        .from("documents")
        .select("*")
        .eq("entity_kind", "lease")
        .eq("entity_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("deposit_transactions")
        .select("*")
        .eq("lease_id", id)
        .order("occurred_on"),
    ]);

  if (!lease) notFound();

  const installments = installmentsResult.data ?? [];
  const occupants = occupantsResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const deposits = depositsResult.data ?? [];

  const collected = installments
    .filter((i) => i.status === "cleared")
    .reduce((sum, i) => sum + Number(i.amount_aed), 0);
  const outstanding = installments
    .filter((i) => i.status !== "cleared" && i.status !== "cancelled")
    .reduce((sum, i) => sum + Number(i.amount_aed), 0);
  const bounced = installments.filter((i) => i.status === "bounced");

  const daysToExpiry = daysUntil(lease.end_date);
  const noticeWindow = settings?.lease_renewal_notice_days ?? 90;
  const occupantWindow = settings?.ejari_occupant_update_days ?? 30;

  // The Ejari occupant record is stale whenever the declared list has changed
  // since it was last pushed. This is the 2026 data-currency requirement.
  const occupantsStale = lease.ejari_occupants_synced_at === null && occupants.length > 0;

  const canManage = can(profile.role, "leases.manage");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tenancies", href: "/leases" }]}
        title={lease.lease_number}
        description={`${lease.units?.properties?.name} · ${lease.units?.unit_number} — ${lease.tenants?.full_name}`}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <LeaseStatusBadge status={lease.status} />
        <EjariBadge
          status={lease.ejari_status}
          contractNumber={lease.ejari_contract_number}
        />
        <Badge variant="outline">
          {lease.installment_count} × {PAYMENT_METHOD[lease.payment_method]}
        </Badge>
        {lease.units && (
          <Link href={`/units/${lease.units.id}`}>
            <Badge variant="muted">View unit →</Badge>
          </Link>
        )}
      </div>

      <div className="mb-5 space-y-3">
        {occupantsStale && (
          <Callout tone="warning" title="Ejari occupant record is out of date">
            The declared occupant list has changed since it was last filed with Ejari.
            Dubai requires occupant details to be updated within {occupantWindow} days
            of any change. Update Ejari, then confirm it on the Occupants tab.
          </Callout>
        )}

        {lease.ejari_status === "not_registered" &&
          (lease.status === "active" || lease.status === "pending_signature") && (
            <Callout tone="danger" title="Tenancy is not registered with Ejari">
              A tenancy contract must be registered with Ejari. Without it the tenant
              cannot obtain DEWA connection or visa sponsorship, and the contract is
              not enforceable at the Rental Dispute Centre.
            </Callout>
          )}

        {bounced.length > 0 && (
          <Callout
            tone="danger"
            title={`${bounced.length} bounced ${bounced.length === 1 ? "cheque" : "cheques"}`}
          >
            {bounced
              .map((b) => `#${b.installment_no} due ${formatDate(b.due_date)}`)
              .join(", ")}
            .
          </Callout>
        )}

        {daysToExpiry !== null &&
          daysToExpiry <= noticeWindow &&
          daysToExpiry >= 0 &&
          (lease.status === "active" || lease.status === "expiring") && (
            <Callout
              tone="warning"
              title={`Tenancy expires in ${daysToExpiry} days`}
            >
              The {noticeWindow}-day notice window is open. A renewal offer, rent
              increase notice or non-renewal notice must be served now to take effect
              on expiry.
            </Callout>
          )}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Annual rent
            </p>
            <Money amount={lease.annual_rent_aed} className="mt-1 block text-xl font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Collected
            </p>
            <Money amount={collected} className="mt-1 block text-xl font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Outstanding
            </p>
            <Money amount={outstanding} className="mt-1 block text-xl font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
              Deposit
            </p>
            <Money
              amount={lease.security_deposit_aed}
              className="mt-1 block text-xl font-semibold"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              {DEPOSIT_STATUS[lease.deposit_status]}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="payments">Payments ({installments.length})</TabsTrigger>
          <TabsTrigger value="occupants">
            Occupants ({occupants.length})
            {occupantsStale && (
              <span className="ml-1.5 size-1.5 rounded-full bg-[var(--destructive)]" />
            )}
          </TabsTrigger>
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
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
                  <Field label="Notice period">{lease.notice_period_days} days</Field>
                  <Field label="Annual rent">
                    <Money amount={lease.annual_rent_aed} />
                  </Field>
                  <Field label="Payment schedule">
                    {lease.installment_count} × {PAYMENT_METHOD[lease.payment_method]}
                  </Field>
                  <Field label="Agency fee">
                    <Money amount={lease.agency_fee_aed} />
                  </Field>
                  <Field label="Ejari fee">
                    <Money amount={lease.ejari_fee_aed} />
                  </Field>
                  <Field label="Move in">{formatDate(lease.move_in_date)}</Field>
                  <Field label="Move out">{formatDate(lease.move_out_date)}</Field>
                </FieldGrid>
                {lease.notes && (
                  <p className="mt-4 text-sm text-[var(--muted-foreground)]">
                    {lease.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Ejari registration</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid columns={2}>
                  <Field label="Contract number">
                    {lease.ejari_contract_number ?? "Not registered"}
                  </Field>
                  <Field label="Registered on">
                    {formatDate(lease.ejari_registered_on)}
                  </Field>
                  <Field label="Expires">{formatDate(lease.ejari_expiry)}</Field>
                  <Field label="Occupants last filed">
                    {lease.ejari_occupants_synced_at
                      ? formatDate(lease.ejari_occupants_synced_at)
                      : "Never"}
                  </Field>
                </FieldGrid>

                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  <p className="mb-3 text-sm font-medium">Signature</p>
                  <FieldGrid columns={2}>
                    <Field label="Tenant signed">
                      {formatDate(lease.tenant_signed_at)}
                    </Field>
                    <Field label="Landlord signed">
                      {formatDate(lease.landlord_signed_at)}
                    </Field>
                  </FieldGrid>
                  {!lease.signature_provider && (
                    <p className="mt-2 text-xs text-[var(--muted-foreground)]">
                      Signatures are recorded manually. The contract flow is
                      structured so UAE Pass / Dubai REST e-signature can be added
                      without changing the record.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Tenant</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid columns={2}>
                  <Field label="Name">{lease.tenants?.full_name}</Field>
                  <Field label="Nationality">{lease.tenants?.nationality ?? "—"}</Field>
                  <Field label="Phone">{lease.tenants?.phone ?? "—"}</Field>
                  <Field label="Email">{lease.tenants?.email ?? "—"}</Field>
                  <Field label="Emirates ID">{lease.tenants?.emirates_id ?? "—"}</Field>
                  <Field label="Emirates ID expiry">
                    {formatDate(lease.tenants?.emirates_id_expiry)}
                  </Field>
                </FieldGrid>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Security deposit</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {deposits.length === 0 ? (
                  <p className="px-5 pb-5 text-sm text-[var(--muted-foreground)]">
                    No deposit movements recorded. Held amount:{" "}
                    <Money amount={lease.security_deposit_aed} />.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Movement</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deposits.map((d) => (
                        <TableRow key={d.id}>
                          <TableCell className="tabular text-sm">
                            {formatDate(d.occurred_on)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {d.kind}
                            {d.reason && (
                              <span className="block text-xs text-[var(--muted-foreground)]">
                                {d.reason}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Money amount={d.amount_aed} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Rent schedule</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead className="hidden md:table-cell">Cheque</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {canManage && <TableHead className="text-right">Record</TableHead>}
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
                      <TableCell className="hidden md:table-cell text-sm">
                        {item.cheque_number ?? "—"}
                        {item.cheque_bank && (
                          <span className="block text-xs text-[var(--muted-foreground)]">
                            {item.cheque_bank}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Money amount={item.amount_aed} />
                      </TableCell>
                      <TableCell>
                        <InstallmentBadge status={item.status} />
                        {item.bounce_reason && (
                          <p className="text-xs text-[var(--destructive)]">
                            {item.bounce_reason}
                          </p>
                        )}
                      </TableCell>
                      {canManage && (
                        <TableCell className="text-right">
                          <InstallmentActions
                            installmentId={item.id}
                            leaseId={id}
                            status={item.status}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell colSpan={3} className="text-sm font-medium">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Money
                        amount={installments.reduce(
                          (s, i) => s + Number(i.amount_aed),
                          0
                        )}
                      />
                    </TableCell>
                    <TableCell colSpan={canManage ? 2 : 1} />
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="occupants">
          <OccupantsPanel
            leaseId={id}
            occupants={occupants}
            stale={occupantsStale}
            lastSyncedAt={lease.ejari_occupants_synced_at}
            windowDays={occupantWindow}
            canSync={can(profile.role, "ejari.manage")}
          />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentList
            documents={documents}
            entityKind="lease"
            entityId={id}
            unitId={lease.unit_id}
            canUpload={can(profile.role, "documents.upload")}
            canDelete={profile.role === "super_admin"}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
