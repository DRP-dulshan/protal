import Link from "next/link";
import { FileText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";
import { PageHeader, EmptyState, Money } from "@/components/domain/shared";
import { StatementStatusBadge } from "@/components/domain/status-badge";
import { ExportButton } from "@/components/domain/export-button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatMonth } from "@/lib/dates";

export const metadata = { title: "My statements" };

export default async function OwnerStatementsPage() {
  await requireRole(["owner"]);
  const supabase = await createClient();

  // Draft statements are deliberately invisible to owners: RLS only exposes
  // issued, approved and paid.
  const { data } = await supabase
    .from("owner_statements")
    .select("*")
    .order("period_start", { ascending: false });

  const statements = data ?? [];

  const exportRows = statements.map((s) => ({
    Statement: s.statement_number,
    "Period start": s.period_start,
    "Period end": s.period_end,
    "Gross income (AED)": s.gross_income_aed,
    "Expenses (AED)": s.total_expenses_aed,
    "Management fee (AED)": s.management_fee_aed,
    "VAT (AED)": s.vat_total_aed,
    "Net payout (AED)": s.net_payout_aed,
    Status: s.status,
  }));

  return (
    <>
      <PageHeader
        title="My statements"
        description="Itemised income, expenses and net payout for each period."
        actions={<ExportButton rows={exportRows} filename="my-statements" />}
      />

      {statements.length === 0 ? (
        <EmptyState
          title="No statements yet"
          description="Your statement is published here once your property manager issues it."
          icon={<FileText className="size-8" />}
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="hidden md:table-cell text-right">Income</TableHead>
                <TableHead className="hidden md:table-cell text-right">Costs</TableHead>
                <TableHead className="text-right">Net payout</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {statements.map((statement) => (
                <TableRow key={statement.id}>
                  <TableCell>
                    <Link
                      href={`/portal/owner/statements/${statement.id}`}
                      className="font-medium hover:underline"
                    >
                      {formatMonth(statement.period_start)}
                    </Link>
                    <p className="text-xs text-[var(--muted-foreground)]">
                      {statement.statement_number}
                      {statement.paid_on && ` · paid ${formatDate(statement.paid_on)}`}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">
                    <Money amount={statement.gross_income_aed} compact />
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-right">
                    <Money
                      amount={
                        Number(statement.total_expenses_aed) +
                        Number(statement.management_fee_aed) +
                        Number(statement.vat_total_aed)
                      }
                      compact
                      muted
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money amount={statement.net_payout_aed} />
                  </TableCell>
                  <TableCell className="text-right">
                    <StatementStatusBadge status={statement.status} />
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
