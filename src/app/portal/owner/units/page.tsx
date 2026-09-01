import { Building2 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader, EmptyState, Money, Field, FieldGrid } from "@/components/domain/shared";
import {
  UnitStatusBadge,
  OperatingModeBadge,
  EjariBadge,
} from "@/components/domain/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { UNIT_KIND } from "@/lib/labels";

export const metadata = { title: "My properties" };

export default async function OwnerUnitsPage() {
  await requireRole(["owner"]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("v_units_overview")
    .select("*")
    .eq("is_active", true)
    .order("property_name");

  const units = data ?? [];

  return (
    <>
      <PageHeader
        title="My properties"
        description="Every unit D|R|P manages on your behalf."
      />

      {units.length === 0 ? (
        <EmptyState
          title="No properties linked"
          description="Your property manager will link your units to this portal."
          icon={<Building2 className="size-8" />}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {units.map((unit) => (
            <Card key={unit.id}>
              <CardContent className="p-5">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {unit.property_name} · {unit.unit_number}
                    </p>
                    <p className="text-sm text-[var(--muted-foreground)]">
                      {unit.community_name}
                      {unit.kind && ` · ${UNIT_KIND[unit.kind]}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unit.status && <UnitStatusBadge status={unit.status} />}
                    {unit.operating_mode && (
                      <OperatingModeBadge mode={unit.operating_mode} />
                    )}
                  </div>
                </div>

                <FieldGrid columns={2}>
                  <Field label="Bedrooms">{unit.bedrooms ?? "—"}</Field>
                  <Field label="Size">
                    {unit.size_sqft
                      ? `${Math.round(Number(unit.size_sqft)).toLocaleString()} sqft`
                      : "—"}
                  </Field>
                  <Field label="Current rent">
                    <Money
                      amount={unit.annual_rent_aed ?? unit.target_annual_rent_aed}
                    />
                  </Field>
                  <Field label="Lease ends">{formatDate(unit.lease_end_date)}</Field>
                </FieldGrid>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
                  {unit.ejari_status && (
                    <EjariBadge
                      status={unit.ejari_status}
                      contractNumber={unit.lease_number}
                    />
                  )}
                  {unit.det_permit_number && (
                    <span className="text-xs text-[var(--muted-foreground)]">
                      DET permit {unit.det_permit_number} · expires{" "}
                      {formatDate(unit.det_permit_expiry)}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
