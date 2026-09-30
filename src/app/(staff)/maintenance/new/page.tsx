import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "New ticket" };

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ unit?: string; kind?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireCapability("maintenance.raise"),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name, owner_name")
      .eq("is_active", true)
      .order("property_name")
      .order("unit_number"),
  ]);

  const units = (data ?? []).map((u) => ({
    id: u.id!,
    label: `${u.property_name} · ${u.unit_number}${u.owner_name ? ` (${u.owner_name})` : ""}`,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Repairs & complaints", href: "/maintenance" }]}
        title="New ticket"
        description="A repair to fix or a complaint to resolve - including ones a tenant, guest or owner phoned in."
      />
      {units.length === 0 && (
        <div className="mb-5">
          <Callout tone="info" title="No units yet">
            Add a unit first; every ticket belongs to a unit.
          </Callout>
        </div>
      )}
      <TicketForm
        units={units}
        defaultUnitId={params.unit}
        defaultKind={params.kind === "complaint" ? "complaint" : "repair"}
      />
    </>
  );
}
