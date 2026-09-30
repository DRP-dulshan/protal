import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { ReportForm } from "./report-form";

export const metadata = { title: "Report an issue" };

export default async function ReportIssuePage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireRole(["owner"]),
    supabase
      .from("owner_units_view")
      .select("id, property_name, unit_number")
      .eq("is_active", true)
      .order("property_name"),
  ]);
  const units = (data ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Repairs & complaints", href: "/portal/owner/maintenance" }]}
        title="Report an issue"
        description="Tell D|R|P about something to repair or a complaint about one of your properties. You can follow it here."
      />
      {units.length === 0 ? (
        <Callout tone="info" title="No properties yet">
          Once D|R|P links your properties to your account, you can report issues for them here.
        </Callout>
      ) : (
        <ReportForm units={units} defaultUnitId={params.unit} />
      )}
    </>
  );
}
