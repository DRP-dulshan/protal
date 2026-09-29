import { notFound } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/domain/shared";
import { OwnerForm } from "../../new/owner-form";

export const metadata = { title: "Edit owner" };

export default async function EditOwnerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const profile = await requireCapability("owners.manage");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const canBank = can(profile.role, "owners.bank_details");
  const supabase = await createClient();
  const [ownerResult, bankResult] = await Promise.all([
    supabase.from("owners").select("*").eq("id", id).maybeSingle(),
    canBank
      ? supabase
          .from("owner_bank_accounts")
          .select("account_holder, bank_name, iban, swift_bic")
          .eq("owner_id", id)
          .eq("is_active", true)
          .eq("is_primary", true)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const owner = ownerResult.data;
  if (!owner) notFound();

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Owners", href: "/owners" },
          { label: owner.full_name, href: `/owners/${id}` },
        ]}
        title="Edit owner"
        description={owner.full_name}
      />
      <OwnerForm canEnterBankDetails={canBank} owner={owner} bank={bankResult.data} />
    </>
  );
}
