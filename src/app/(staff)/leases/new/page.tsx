import { createClient } from "@/lib/supabase/server";
import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { PageHeader, Callout } from "@/components/domain/shared";
import { LeaseForm } from "./lease-form";

export const metadata = { title: "New tenancy" };

export default async function NewLeasePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const [, settings, unitsResult, tenantsResult] = await Promise.all([
    requireCapability("leases.manage"),
    getCompanySettings(),
    // Only units that can actually take a long-term tenancy.
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name, target_annual_rent_aed, status, operating_mode")
      .eq("is_active", true)
      .in("operating_mode", ["long_term", "both"])
      .order("property_name"),
    supabase
      .from("tenants")
      .select("id, full_name, is_company")
      .eq("is_active", true)
      .order("full_name"),
  ]);

  const units = (unitsResult.data ?? []).map((u) => ({
    id: u.id as string,
    label: `${u.property_name} · ${u.unit_number}`,
    targetRent: u.target_annual_rent_aed,
    occupied: u.status === "occupied_long_term",
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Tenancies", href: "/leases" }]}
        title="New tenancy"
        description="Creates the contract and its cheque schedule together."
      />

      {units.length === 0 && (
        <div className="mb-5">
          <Callout tone="info" title="No eligible units">
            Add a unit set to long-term or dual mode before creating a tenancy.
          </Callout>
        </div>
      )}

      <LeaseForm
        units={units}
        tenants={tenantsResult.data ?? []}
        defaultUnitId={params.unit}
        noticeDays={settings?.lease_renewal_notice_days ?? 90}
      />
    </>
  );
}
