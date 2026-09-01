import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { PropertyForm } from "./property-form";

export const metadata = { title: "Add property" };

export default async function NewPropertyPage() {
  await requireCapability("properties.manage");
  const supabase = await createClient();

  const { data } = await supabase
    .from("communities")
    .select("id, name, emirate")
    .order("name");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Properties", href: "/properties" }]}
        title="Add property"
        description="A building, villa compound or standalone property containing units under management."
      />
      <PropertyForm communities={data ?? []} />
    </>
  );
}
