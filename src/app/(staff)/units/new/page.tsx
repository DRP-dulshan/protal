import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { UnitForm } from "./unit-form";

export const metadata = { title: "Add unit" };

export default async function NewUnitPage({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [, propertiesResult, ownersResult] = await Promise.all([

    requireCapability("units.manage"),
    supabase
      .from("properties")
      .select("id, name, communities(name)")
      .eq("is_active", true)
      .order("name"),
    supabase.from("owners").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Units", href: "/units" }]}
        title="Add unit"
        description="Register a unit under management, with its Dubai identifiers and owner."
      />
      <UnitForm
        properties={(propertiesResult.data ?? []).map((p) => ({
          id: p.id,
          label: p.communities?.name ? `${p.name} — ${p.communities.name}` : p.name,
        }))}
        owners={ownersResult.data ?? []}
        defaultPropertyId={params.property}
      />
    </>
  );
}
