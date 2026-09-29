import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { UnitForm, type CurrentOwnership } from "../../new/unit-form";

export const metadata = { title: "Edit unit" };

export default async function EditUnitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCapability("units.manage");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [unitResult, ownershipResult, propertiesResult, ownersResult] = await Promise.all([
    supabase.from("units").select("*, properties(name)").eq("id", id).maybeSingle(),
    supabase
      .from("unit_ownerships")
      .select("owner_id, ownership_pct")
      .eq("unit_id", id)
      .is("end_date", null),
    supabase
      .from("properties")
      .select("id, name, is_active, communities(name)")
      .order("name"),
    supabase.from("owners").select("id, full_name, is_active").order("full_name"),
  ]);

  const unit = unitResult.data;
  if (!unit) notFound();

  const active = ownershipResult.data ?? [];
  const ownership: CurrentOwnership =
    active.length > 1
      ? "shared"
      : active[0]
        ? { ownerId: active[0].owner_id, pct: Number(active[0].ownership_pct) }
        : null;

  // Archived properties and owners stay selectable only when this unit already
  // uses them, so saving never silently moves it.
  const currentOwnerId = ownership && ownership !== "shared" ? ownership.ownerId : null;
  const properties = (propertiesResult.data ?? [])
    .filter((p) => p.is_active || p.id === unit.property_id)
    .map((p) => ({
      id: p.id,
      label: p.communities?.name ? `${p.name} — ${p.communities.name}` : p.name,
    }));
  const owners = (ownersResult.data ?? []).filter(
    (o) => o.is_active || o.id === currentOwnerId
  );

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Units", href: "/units" },
          { label: `${unit.properties?.name ?? ""} ${unit.unit_number}`, href: `/units/${id}` },
        ]}
        title="Edit unit"
        description={`${unit.properties?.name ?? ""} · ${unit.unit_number}`}
      />
      <UnitForm properties={properties} owners={owners} unit={unit} ownership={ownership} />
    </>
  );
}
