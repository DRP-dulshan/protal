import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { AddListingsForm } from "./add-listings-form";

export const metadata = { title: "Add Airbnb listings" };

export default async function AddAirbnbListingsPage() {
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireCapability("properties.manage"),
    supabase.from("properties").select("name").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Calendar sync", href: "/calendar-sync" }, { label: "Add Airbnb listings" }]}
        title="Add Airbnb listings"
        description="Bring each Airbnb listing in as a holiday-home unit, with its calendar connected. Link the owners afterwards."
      />
      <AddListingsForm buildings={(data ?? []).map((p) => p.name)} />
    </>
  );
}
