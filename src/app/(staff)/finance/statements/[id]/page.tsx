import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/domain/shared";
import { StatementStatusBadge } from "@/components/domain/status-badge";
import { StatementDocument } from "@/components/domain/statement-document";
import { StatementActions } from "./statement-actions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("owner_statements")
    .select("statement_number")
    .eq("id", id)
    .maybeSingle();
  return { title: data?.statement_number ?? "Statement" };
}

export default async function StatementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireCapability("statements.view");
  const supabase = await createClient();
  const settings = await getCompanySettings();

  const { data: statement } = await supabase
    .from("owner_statements")
    .select("*, owners(id, full_name, email, phone, address_line, trn)")
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
          breadcrumb={[
            { label: "Finance", href: "/finance" },
            { label: "Statements", href: "/finance/statements" },
          ]}
          title={statement.statement_number}
          description={statement.owners?.full_name ?? undefined}
          actions={
            <StatementActions
              statementId={id}
              status={statement.status}
              canIssue={can(profile.role, "statements.issue")}
            />
          }
        />
        <div className="mb-5">
          <StatementStatusBadge status={statement.status} />
        </div>
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
