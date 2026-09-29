import Link from "next/link";
import { Building2, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader, EmptyState, Field, FieldGrid } from "@/components/domain/shared";
import { UnitStatusBadge, OperatingModeBadge } from "@/components/domain/status-badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { UNIT_KIND } from "@/lib/labels";

export const metadata = { title: "My properties" };

export default async function OwnerUnitsPage() {
  await requireRole(["owner"]);
  const supabase = await createClient();

  const { data } = await supabase
    .from("owner_units_view")
    .select("*")
    .eq("is_active", true)
    .order("property_name");

  const units = data ?? [];

  return (
    <>
      <PageHeader
        title="My properties"
        description="Every unit D|R|P manages on your behalf. Open one to see its booking calendar."
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
            <Link key={unit.id} href={`/portal/owner/units/${unit.id}`} className="block">
              <Card className="h-full transition-shadow hover:shadow-md">
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      {unit.status && <UnitStatusBadge status={unit.status} />}
                      {unit.operating_mode && <OperatingModeBadge mode={unit.operating_mode} />}
                      <ChevronRight className="size-4 text-[var(--muted-foreground)]" />
                    </div>
                  </div>

                  <FieldGrid columns={2}>
                    <Field label="Bedrooms">
                      {Number(unit.bedrooms) === 0 ? "Studio" : (unit.bedrooms ?? "—")}
                    </Field>
                    <Field label="Size">
                      {unit.size_sqft
                        ? `${Math.round(Number(unit.size_sqft)).toLocaleString()} sqft`
                        : "—"}
                    </Field>
                    <Field label="Max guests">{unit.max_guests ?? "—"}</Field>
                    <Field label="DET permit">
                      {unit.det_permit_number
                        ? `${unit.det_permit_number} · to ${formatDate(unit.det_permit_expiry)}`
                        : "—"}
                    </Field>
                  </FieldGrid>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
