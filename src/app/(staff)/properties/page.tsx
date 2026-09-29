import Link from "next/link";
import { Archive, Building2, Pencil, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PROPERTY_KIND, EMIRATE } from "@/lib/labels";

export const metadata = { title: "Properties" };

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const profile = await requireCapability("units.view");
  const archived = (await searchParams).show === "archived";
  const canManage = can(profile.role, "properties.manage");
  const supabase = await createClient();

  const [propertiesResult, unitsResult] = await Promise.all([
    supabase
      .from("properties")
      .select("*, communities(name, emirate)")
      .eq("is_active", !archived)
      .order("name"),
    supabase.from("v_units_overview").select("property_id, status").eq("is_active", true),
  ]);

  const properties = propertiesResult.data ?? [];
  const units = unitsResult.data ?? [];

  const statsFor = (propertyId: string) => {
    const own = units.filter((u) => u.property_id === propertyId);
    return {
      total: own.length,
      occupied: own.filter(
        (u) => u.status === "occupied_long_term" || u.status === "listed_short_term"
      ).length,
    };
  };

  const exportRows = properties.map((p) => {
    const stats = statsFor(p.id);
    return {
      Name: p.name,
      Type: PROPERTY_KIND[p.kind],
      Community: p.communities?.name ?? "",
      Emirate: p.communities?.emirate ? EMIRATE[p.communities.emirate] : "",
      Developer: p.developer_name ?? "",
      "Owners association": p.owners_association_name ?? "",
      "Mollak ID": p.mollak_property_id ?? "",
      "Units managed": stats.total,
      Occupied: stats.occupied,
    };
  });

  return (
    <>
      <PageHeader
        title={archived ? "Archived properties" : "Properties"}
        description={
          archived
            ? "Properties D|R|P no longer manages. Open one to restore it."
            : "Communities, buildings and villa compounds with units under management."
        }
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={archived ? "/properties" : "/properties?show=archived"}>
                {archived ? <Building2 className="size-4" /> : <Archive className="size-4" />}
                {archived ? "Active properties" : "Archived"}
              </Link>
            </Button>
            <ExportButton rows={exportRows} filename="drp-properties" />
            {canManage && (
              <Button asChild>
                <Link href="/properties/new">
                  <Plus className="size-4" />
                  Add property
                </Link>
              </Button>
            )}
          </>
        }
      />

      {properties.length === 0 ? (
        <EmptyState
          title={archived ? "No archived properties" : "No properties"}
          description={
            archived
              ? "Archived properties appear here."
              : "Add the buildings and compounds where D|R|P manages units."
          }
          icon={<Building2 className="size-8" />}
          action={
            can(profile.role, "properties.manage") ? (
              <Button asChild>
                <Link href="/properties/new">Add property</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {properties.map((property) => {
            const stats = statsFor(property.id);
            const rate = stats.total
              ? Math.round((stats.occupied / stats.total) * 100)
              : 0;

            return (
              <Card key={property.id} className="flex h-full flex-col transition-shadow hover:shadow-md">
                <Link
                  href={`/units?q=${encodeURIComponent(property.name)}`}
                  className="flex-1"
                >
                  <CardContent className="p-5">
                    <div className="mb-3 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{property.name}</p>
                        <p className="truncate text-sm text-[var(--muted-foreground)]">
                          {property.communities?.name}
                          {property.communities?.emirate &&
                            ` · ${EMIRATE[property.communities.emirate]}`}
                        </p>
                      </div>
                      <Badge variant="muted">{PROPERTY_KIND[property.kind]}</Badge>
                    </div>

                    <div className="mb-3 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                          Units managed
                        </p>
                        <p className="tabular text-lg font-semibold">{stats.total}</p>
                      </div>
                      <div>
                        <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                          Occupied
                        </p>
                        <p className="tabular text-lg font-semibold">{rate}%</p>
                      </div>
                    </div>

                    {property.owners_association_name && (
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        OA: {property.owners_association_name}
                        {property.mollak_property_id &&
                          ` · Mollak ${property.mollak_property_id}`}
                      </p>
                    )}
                    {property.developer_name && (
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        Developer: {property.developer_name}
                      </p>
                    )}
                  </CardContent>
                </Link>
                {canManage && (
                  <div className="border-t border-[var(--border)] px-5 py-2">
                    <Button asChild size="sm" variant="ghost" className="-ml-2">
                      <Link href={`/properties/${property.id}/edit`}>
                        <Pencil className="size-4" />
                        Edit
                      </Link>
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
