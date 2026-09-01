import Link from "next/link";
import { Users, Plus, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader, EmptyState } from "@/components/domain/shared";
import { ExportButton } from "@/components/domain/export-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Owners" };

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const profile = await requireCapability("owners.view");
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("owners")
    .select("*, unit_ownerships(unit_id, ownership_pct, end_date), owner_users(profile_id)")
    .eq("is_active", true)
    .order("full_name");

  if (params.q) {
    query = query.or(
      `full_name.ilike.%${params.q}%,email.ilike.%${params.q}%,phone.ilike.%${params.q}%`
    );
  }

  const { data, error } = await query;
  const owners = (data ?? []).map((owner) => ({
    ...owner,
    unitCount: (owner.unit_ownerships ?? []).filter((o) => o.end_date === null).length,
    hasPortalAccess: (owner.owner_users ?? []).length > 0,
  }));

  const exportRows = owners.map((o) => ({
    Name: o.full_name,
    Type: o.is_company ? "Company" : "Individual",
    Email: o.email ?? "",
    Phone: o.phone ?? "",
    Nationality: o.nationality ?? "",
    "Emirates ID": o.emirates_id ?? "",
    TRN: o.trn ?? "",
    Units: o.unitCount,
    "Portal access": o.hasPortalAccess ? "Yes" : "No",
  }));

  return (
    <>
      <PageHeader
        title="Owners"
        description={`${owners.length} owner${owners.length === 1 ? "" : "s"} with property under management`}
        actions={
          <>
            <ExportButton rows={exportRows} filename="drp-owners" />
            {can(profile.role, "owners.manage") && (
              <Button asChild>
                <Link href="/owners/new">
                  <Plus className="size-4" />
                  Add owner
                </Link>
              </Button>
            )}
          </>
        }
      />

      <Card className="mb-4">
        <CardContent className="p-3">
          <form className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Search by name, email or phone"
              className="pl-8"
            />
          </form>
        </CardContent>
      </Card>

      {error ? (
        <EmptyState title="Could not load owners" description={error.message} />
      ) : owners.length === 0 ? (
        <EmptyState
          title="No owners"
          description="Add the owners whose property D|R|P manages, then link their units and management agreements."
          icon={<Users className="size-8" />}
          action={
            can(profile.role, "owners.manage") ? (
              <Button asChild>
                <Link href="/owners/new">Add owner</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Owner</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden lg:table-cell">Nationality</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Portal</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell>
                    <Link
                      href={`/owners/${owner.id}`}
                      className="font-medium hover:underline"
                    >
                      {owner.full_name}
                    </Link>
                    {owner.is_company && (
                      <Badge variant="muted" className="ml-2">
                        Company
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <p className="text-sm">{owner.email ?? "—"}</p>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {owner.phone ?? ""}
                    </p>
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm">
                    {owner.nationality ?? "—"}
                  </TableCell>
                  <TableCell className="tabular text-right text-sm">
                    {owner.unitCount}
                  </TableCell>
                  <TableCell className="text-right">
                    {owner.hasPortalAccess ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="muted">Not invited</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </>
  );
}
