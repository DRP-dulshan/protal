import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { Callout, PageHeader } from "@/components/domain/shared";
import { RecordActions } from "@/components/domain/record-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PropertyForm } from "../../new/property-form";
import { archiveProperty, deleteProperty, restoreProperty } from "../../actions";

export const metadata = { title: "Edit property" };

export default async function EditPropertyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [profile, propertyResult, communitiesResult] = await Promise.all([
    requireCapability("properties.manage"),
    supabase.from("properties").select("*").eq("id", id).maybeSingle(),
    supabase.from("communities").select("id, name, emirate").order("name"),
  ]);

  const property = propertyResult.data;
  if (!property) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Properties", href: "/properties" }]}
        title="Edit property"
        description={property.name}
      />

      {!property.is_active && (
        <div className="mb-5">
          <Callout tone="warning" title="This property is archived">
            It is hidden from the properties list and cannot be chosen for new units.
          </Callout>
        </div>
      )}

      <PropertyForm communities={communitiesResult.data ?? []} property={property} />

      <Card className="mt-5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Archive or delete</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-[var(--muted-foreground)]">
            Archive a property D|R|P no longer manages; its units must be archived or
            moved first. Delete is only for a property added by mistake and with no
            units.
          </p>
          <RecordActions
            noun="property"
            idName="propertyId"
            id={property.id}
            isActive={property.is_active}
            archive={archiveProperty}
            restore={restoreProperty}
            remove={profile.role === "super_admin" ? deleteProperty : undefined}
          />
        </CardContent>
      </Card>
    </>
  );
}
