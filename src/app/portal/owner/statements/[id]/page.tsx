import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getCompanySettings } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { StatementDocument } from "@/components/domain/statement-document";
import { PrintButton } from "@/components/domain/print-button";

export const metadata = { title: "Statement" };

export default async function OwnerStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requireRole(["owner"]);
  const supabase = await createClient();
  const settings = await getCompanySettings();

  const { data: statement } = await supabase
    .from("owner_statements")
    .select("*, owners(full_name, email, phone, address_line, trn)")
    .eq("id", id)
    .maybeSingle();

  if (!statement) notFound();

  const { data: lines } = await supabase
    .from("owner_statement_lines")
    .select("*")
    .eq("statement_id", id)
    .order("sort_order");

  return (
    <>
      <div className="no-print">
        <PageHeader
          breadcrumb={[{ label: "My statements", href: "/portal/owner/statements" }]}
          title={statement.statement_number}
          actions={<PrintButton />}
        />
      </div>

      <StatementDocument
        statement={statement}
        lines={lines ?? []}
        owner={statement.owners}
        company={settings}
      />
    </>
  );
}
