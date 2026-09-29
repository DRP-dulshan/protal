import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { DocumentList } from "@/components/domain/document-list";

export const metadata = { title: "My documents" };

export default async function OwnerDocumentsPage() {
  const supabase = await createClient();

  // RLS returns only documents flagged owner-visible on units this login owns,
  // and never income records (statements, invoices, receipts, cheque copies,
  // tenancy contracts, Ejari certificates) - see pms.is_income_document().
  const [, { data }] = await Promise.all([
    requireRole(["owner"]),
    supabase.from("documents").select("*").order("created_at", { ascending: false }),
  ]);

  return (
    <>
      <PageHeader
        title="My documents"
        description="Title deeds, permits and other documents D|R|P has shared for your properties."
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
