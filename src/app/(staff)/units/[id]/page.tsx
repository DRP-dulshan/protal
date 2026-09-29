import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, FileSignature, Pencil, Plus, ShieldAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import {
  PageHeader,
  Field,
  FieldGrid,
  Money,
  EmptyState,
  Callout,
} from "@/components/domain/shared";
import {
  UnitStatusBadge,
  OperatingModeBadge,
  EjariBadge,
  PermitBadge,
  LeaseStatusBadge,
  ComplianceBadge,
} from "@/components/domain/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DocumentList } from "@/components/domain/document-list";
import { formatDate } from "@/lib/dates";
import { formatPercent } from "@/lib/money";
import { UNIT_KIND, FURNISHING, COMPLIANCE_KIND } from "@/lib/labels";
import { RecordActions } from "@/components/domain/record-actions";
import { archiveUnit, deleteUnit, restoreUnit } from "../actions";
import { PermitDialog } from "./permit-dialog";
import { BlockDatesDialog, RemoveBlockButton } from "./block-dates";
import { BookingCalendar } from "@/components/domain/booking-calendar";
import { dubaiToday, monthGrid, parseMonth } from "@/lib/calendar";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_units_overview")
    .select("unit_number, property_name")
    .eq("id", id)
    .maybeSingle();

  return {
    title: data ? `${data.property_name} ${data.unit_number}` : "Unit",
  };
}

export default async function UnitDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; month?: string }>;
}) {
  const { id } = await params;
  const { tab, month: monthParam } = await searchParams;
  const month = parseMonth(monthParam);
  const grid = monthGrid(month);
  const gridStart = grid[0][0];
  const gridEnd = grid[grid.length - 1][6];
  const profile = await requireCapability("units.view");
  const supabase = await createClient();

  const { data: unit } = await supabase
    .from("units")
    .select("*, properties(id, name, kind, community_id, communities(name, emirate))")
    .eq("id", id)
    .maybeSingle();

  if (!unit) notFound();

  const [
    overviewResult,
    ownershipResult,
    leasesResult,
    permitResult,
    complianceResult,
    documentsResult,
    agreementResult,
    staysResult,
    blocksResult,
  ] = await Promise.all([
    supabase.from("v_units_overview").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("unit_ownerships")
      .select("*, owners(id, full_name, email, phone, is_company)")
      .eq("unit_id", id)
      .is("end_date", null),
    supabase
      .from("leases")
      .select("*, tenants(id, full_name, email, phone)")
      .eq("unit_id", id)
      .order("start_date", { ascending: false }),
    supabase
      .from("holiday_home_permits")
      .select("*")
      .eq("unit_id", id)
      .order("expires_on", { ascending: false }),
    supabase
      .from("v_compliance_status")
      .select("*")
      .eq("unit_id", id)
      .neq("severity", "ok")
      .order("days_remaining"),
    supabase
      .from("documents")
      .select("*")
      .eq("unit_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("management_agreements")
      .select("*, owners(full_name)")
      .eq("unit_id", id)
      .eq("is_active", true)
      .maybeSingle(),
    supabase
      .from("bookings")
      .select("id, check_in, check_out, channel, status, guests(full_name)")
      .eq("unit_id", id)
      .in("status", ["inquiry", "tentative", "confirmed", "checked_in", "checked_out"])
      .lte("check_in", gridEnd)
      .gt("check_out", gridStart),
    supabase
      .from("availability_blocks")
      .select("id, start_date, end_date, reason, note")
      .eq("unit_id", id)
      .neq("reason", "booking")
      .gt("end_date", dubaiToday() < gridStart ? dubaiToday() : gridStart)
      .order("start_date"),
  ]);

  const overview = overviewResult.data;
  const ownerships = ownershipResult.data ?? [];
  const leases = leasesResult.data ?? [];
  const permits = permitResult.data ?? [];
  const compliance = complianceResult.data ?? [];
  const documents = documentsResult.data ?? [];
  const agreement = agreementResult.data;
  const stays = (staysResult.data ?? []).map((b) => ({
    id: b.id,
    checkIn: b.check_in,
    checkOut: b.check_out,
    source: b.channel,
    label: b.guests?.full_name ?? null,
    pending: b.status === "inquiry" || b.status === "tentative",
    href: `/bookings/${b.id}`,
  }));
  const holds = blocksResult.data ?? [];
  const today = dubaiToday();
  const upcomingHolds = holds.filter((h) => h.end_date > today);

  const activeLease = leases.find(
    (l) => l.status === "active" || l.status === "expiring"
  );
  const property = unit.properties;
  const isShortTerm =
    unit.operating_mode === "short_term" || unit.operating_mode === "both";
  const hasValidPermit = overview?.has_valid_permit ?? false;

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Units", href: "/units" },
          { label: property?.name ?? "Property" },
        ]}
        title={`${property?.name ?? ""} · ${unit.unit_number}`}
        description={[
          unit.reference_code,
          property?.communities?.name,
          UNIT_KIND[unit.kind],
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          can(profile.role, "units.manage") ? (
            <>
              <Button asChild size="sm" variant="outline">
                <Link href={`/units/${unit.id}/edit`}>
                  <Pencil className="size-4" />
                  Edit
                </Link>
              </Button>
              <RecordActions
                noun="unit"
                idName="unitId"
                id={unit.id}
                isActive={unit.is_active}
                archive={archiveUnit}
                restore={restoreUnit}
                remove={profile.role === "super_admin" ? deleteUnit : undefined}
              />
            </>
          ) : undefined
        }
      />

      {!unit.is_active && (
        <div className="mb-5">
          <Callout tone="warning" title="This unit is archived">
            It is hidden from lists, the dashboard and reports. Its history is kept.
            Restore it to put it back under management.
          </Callout>
        </div>
      )}

      <div className="mb-5 flex flex-wrap gap-2">
        <UnitStatusBadge status={unit.status} />
        <OperatingModeBadge mode={unit.operating_mode} />
        {activeLease && (
          <EjariBadge
            status={activeLease.ejari_status}
            contractNumber={activeLease.ejari_contract_number}
          />
        )}
        {isShortTerm && permits[0] && (
          <PermitBadge status={permits[0].status} permitNumber={permits[0].permit_number} />
        )}
      </div>

      {isShortTerm && !hasValidPermit && (
        <div className="mb-5">
          <Callout tone="danger" title="No valid DET holiday home permit on file">
            This unit is set up for short-term letting but has no active permit. The
            system will refuse to activate any channel listing or accept a booking
            until one is recorded.
          </Callout>
        </div>
      )}

      {compliance.length > 0 && (
        <Card className="mb-5 border-[var(--warning)]/40">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="size-4" />
              Compliance attention ({compliance.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {compliance.map((item, i) => (
                <li
                  key={i}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm"
                >
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {item.kind ? COMPLIANCE_KIND[item.kind] : ""} ·{" "}
                      {formatDate(item.due_date)}
                    </span>
                  </span>
                  <ComplianceBadge
                    severity={item.severity ?? "missing"}
                    daysRemaining={item.days_remaining}
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Tabs
        defaultValue={
          tab && ["tenancy", "calendar", "permits", "documents"].includes(tab) ? tab : "overview"
        }
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tenancy">Tenancy</TabsTrigger>
          {isShortTerm && <TabsTrigger value="calendar">Calendar</TabsTrigger>}
          {isShortTerm && <TabsTrigger value="permits">DET permits</TabsTrigger>}
          <TabsTrigger value="documents">Documents ({documents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Unit details</CardTitle>
              </CardHeader>
              <CardContent>
                <FieldGrid>
                  <Field label="Type">{UNIT_KIND[unit.kind]}</Field>
                  <Field label="Bedrooms / bathrooms">
                    {unit.bedrooms} / {unit.bathrooms}
                  </Field>
                  <Field label="Size">
                    {unit.size_sqft
                      ? `${Number(unit.size_sqft).toLocaleString()} sqft · ${Number(unit.size_sqm).toLocaleString()} sqm`
                      : "—"}
                  </Field>
                  <Field label="Furnishing">{FURNISHING[unit.furnishing]}</Field>
                  <Field label="Floor">{unit.floor ?? "—"}</Field>
                  <Field label="Parking">
                    {unit.parking_spaces > 0
                      ? `${unit.parking_spaces} · ${unit.parking_numbers?.join(", ") ?? ""}`
                      : "None"}
                  </Field>
                  <Field label="View">{unit.view_description ?? "—"}</Field>
                  <Field label="DEWA premise">{unit.dewa_premise_number ?? "—"}</Field>
                  <Field label="Title deed">{unit.title_deed_number ?? "—"}</Field>
                  <Field label="Makani">{unit.makani_number ?? "—"}</Field>
                  <Field label="DLD property no.">
                    {unit.dld_property_number ?? "—"}
                  </Field>
                  <Field label="Mollak unit ID">{unit.mollak_unit_id ?? "—"}</Field>
                </FieldGrid>
              </CardContent>
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Ownership</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {ownerships.length === 0 ? (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No ownership record on file.
                    </p>
                  ) : (
                    ownerships.map((o) => (
                      <div key={o.id} className="text-sm">
                        <Link
                          href={`/owners/${o.owners?.id}`}
                          className="font-medium hover:underline"
                        >
                          {o.owners?.full_name}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {formatPercent(o.ownership_pct)} share
                          {o.is_primary_contact && " · primary contact"}
                        </p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Management agreement</CardTitle>
                </CardHeader>
                <CardContent>
                  {agreement ? (
                    <dl className="space-y-2">
                      <Field label="Agreement">{agreement.agreement_number}</Field>
                      <Field label="Term">
                        {formatDate(agreement.start_date)} –{" "}
                        {formatDate(agreement.end_date)}
                      </Field>
                      <Field label="Fee">
                        {agreement.commission_pct
                          ? `${formatPercent(agreement.commission_pct)} of revenue`
                          : <Money amount={agreement.fixed_fee_aed} />}
                        {agreement.fee_vat_applicable && " + VAT"}
                      </Field>
                      <Field label="Auto renew">
                        {agreement.auto_renew ? "Yes" : "No"}
                      </Field>
                    </dl>
                  ) : (
                    <p className="text-sm text-[var(--muted-foreground)]">
                      No active management agreement. Owner statements cannot charge a
                      management fee for this unit until one is recorded.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="tenancy">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Tenancy history</CardTitle>
              {can(profile.role, "leases.manage") && (
                <Button asChild size="sm">
                  <Link href={`/leases/new?unit=${id}`}>
                    <Plus className="size-4" />
                    New tenancy
                  </Link>
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {leases.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No tenancies recorded"
                    description="Create a tenancy contract to start tracking rent, Ejari and occupants."
                    icon={<FileSignature className="size-8" />}
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Contract</TableHead>
                      <TableHead>Tenant</TableHead>
                      <TableHead>Term</TableHead>
                      <TableHead className="hidden md:table-cell">Ejari</TableHead>
                      <TableHead className="text-right">Annual rent</TableHead>
                      <TableHead className="text-right">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leases.map((lease) => (
                      <TableRow key={lease.id}>
                        <TableCell>
                          <Link
                            href={`/leases/${lease.id}`}
                            className="font-medium hover:underline"
                          >
                            {lease.lease_number}
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm">
                          {lease.tenants?.full_name ?? "—"}
                        </TableCell>
                        <TableCell className="tabular whitespace-nowrap text-sm">
                          {formatDate(lease.start_date)} – {formatDate(lease.end_date)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
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
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {isShortTerm && (
          <>
          <TabsContent value="calendar">
            <Card className="mb-5">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">Availability</CardTitle>
                {can(profile.role, "bookings.manage") && (
                  <div className="flex flex-wrap gap-2">
                    <BlockDatesDialog unitId={unit.id} />
                    <Button asChild size="sm">
                      <Link href={`/bookings/new?unit=${unit.id}`}>
                        <CalendarPlus className="size-4" />
                        New booking
                      </Link>
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <BookingCalendar
                  month={month}
                  stays={stays}
                  blocks={holds.map((h) => ({
                    id: h.id,
                    start: h.start_date,
                    end: h.end_date,
                    reason: h.reason,
                  }))}
                  monthHref={(m) => `/units/${unit.id}?tab=calendar&month=${m}`}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Blocked dates</CardTitle>
              </CardHeader>
              <CardContent>
                {upcomingHolds.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    No upcoming owner stays, maintenance or other blocks.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {upcomingHolds.map((h) => (
                      <li
                        key={h.id}
                        className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-2 last:border-0 last:pb-0"
                      >
                        <div className="min-w-0 text-sm">
                          <span className="font-medium">
                            {h.reason === "owner_stay"
                              ? "Owner stay"
                              : h.reason === "maintenance"
                                ? "Maintenance"
                                : "Blocked"}
                          </span>
                          <span className="tabular ml-2 text-[var(--muted-foreground)]">
                            {formatDate(h.start_date)} → {formatDate(h.end_date)}
                          </span>
                          {h.note && (
                            <p className="truncate text-xs text-[var(--muted-foreground)]">{h.note}</p>
                          )}
                        </div>
                        {can(profile.role, "bookings.manage") && (
                          <RemoveBlockButton blockId={h.id} unitId={unit.id} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="permits">
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">DET holiday home permits</CardTitle>
                {can(profile.role, "permits.manage") && (
                  <PermitDialog unitId={unit.id} hasPermit={permits.length > 0} />
                )}
              </CardHeader>
              <CardContent className="p-0">
                {permits.length === 0 ? (
                  <div className="p-5">
                    <EmptyState
                      title="No permit on file"
                      description="Dubai requires a valid DET permit before a holiday home may be advertised or let. The permit number must appear on every OTA listing."
                    />
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Permit number</TableHead>
                        <TableHead>Classification</TableHead>
                        <TableHead>Validity</TableHead>
                        <TableHead className="hidden md:table-cell">NOC</TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {permits.map((permit) => (
                        <TableRow key={permit.id}>
                          <TableCell className="font-medium">
                            {permit.permit_number}
                          </TableCell>
                          <TableCell className="text-sm">
                            {permit.det_classification ?? "—"}
                          </TableCell>
                          <TableCell className="tabular whitespace-nowrap text-sm">
                            {formatDate(permit.issued_on)} –{" "}
                            {formatDate(permit.expires_on)}
                          </TableCell>
                          <TableCell className="hidden md:table-cell text-sm">
                            {permit.noc_reference ?? "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            <PermitBadge status={permit.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          </>
        )}

        <TabsContent value="documents">
          <DocumentList
            documents={documents}
            entityKind="unit"
            entityId={id}
            unitId={id}
            canUpload={can(profile.role, "documents.upload")}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
