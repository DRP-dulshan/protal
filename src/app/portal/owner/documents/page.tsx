import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { DocumentList } from "@/components/domain/document-list";

export const metadata = { title: "My documents" };

export default async function OwnerDocumentsPage() {
  await requireRole(["owner"]);
  const supabase = await createClient();

  // RLS returns only documents flagged owner-visible on units this login owns.
  const { data } = await supabase
    .from("documents")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="My documents"
        description="Title deeds, tenancy contracts, Ejari certificates, permits and management agreements for your properties."
      />
      <DocumentList
        documents={data ?? []}
        entityKind="owner"
        canUpload={false}
        title="Shared with you"
      />
    </>
  );
}
