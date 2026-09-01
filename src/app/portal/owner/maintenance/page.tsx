import { Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireRole, getCompanySettings } from "@/lib/auth/session";
import { PageHeader, EmptyState, Money, Callout } from "@/components/domain/shared";
import {
  MaintenanceStatusBadge,
  PriorityBadge,
} from "@/components/domain/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ApprovalButtons } from "./approval-buttons";
import { formatDate } from "@/lib/dates";
import { formatAED } from "@/lib/money";
import { MAINTENANCE_CATEGORY } from "@/lib/labels";

export const metadata = { title: "Maintenance" };

export default async function OwnerMaintenancePage() {
  await requireRole(["owner"]);
  const supabase = await createClient();
  const settings = await getCompanySettings();

  const { data } = await supabase
    .from("maintenance_requests")
    .select("*, units(unit_number, properties(name)), vendors(name)")
    .order("reported_at", { ascending: false });

  const tickets = data ?? [];
  const awaiting = tickets.filter(
    (t) => t.owner_approval_required && !t.owner_approved_at && !t.owner_rejected_at
  );
  const others = tickets.filter((t) => !awaiting.includes(t));

  const threshold = settings?.maintenance_owner_approval_threshold ?? 1000;

  return (
    <>
      <PageHeader
        title="Maintenance"
        description={`Work on your properties. Anything quoted above ${formatAED(threshold, { decimals: false })} needs your approval before it starts.`}
      />

      {awaiting.length > 0 && (
        <section className="mb-6">
          <Callout tone="warning" title="Waiting on your decision">
            {awaiting.length} {awaiting.length === 1 ? "job is" : "jobs are"} on hold
            until approved.
          </Callout>

          <div className="mt-4 space-y-4">
            {awaiting.map((ticket) => (
              <Card key={ticket.id} className="border-[var(--brand)]/40">
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="text-base">{ticket.title}</CardTitle>
                      <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                        {ticket.units?.properties?.name} · {ticket.units?.unit_number}
                        {" · "}
                        {MAINTENANCE_CATEGORY[ticket.category]}
                        {" · "}
                        {ticket.ticket_number}
                      </p>
                    </div>
                    <PriorityBadge value={ticket.priority} />
                  </div>
                </CardHeader>
                <CardContent>
                  {ticket.description && (
                    <p className="mb-4 text-sm">{ticket.description}</p>
                  )}

                  <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg bg-[var(--muted)] p-4 sm:grid-cols-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Quoted
                      </p>
                      <Money
                        amount={ticket.quoted_amount_aed}
                        className="mt-0.5 block font-semibold"
                      />
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Contractor
                      </p>
                      <p className="mt-0.5 truncate text-sm">
                        {ticket.vendors?.name ?? "To be assigned"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
                        Reported
                      </p>
                      <p className="mt-0.5 text-sm">{formatDate(ticket.reported_at)}</p>
                    </div>
                  </div>

                  <ApprovalButtons
                    ticketId={ticket.id}
                    quotedAmount={Number(ticket.quoted_amount_aed ?? 0)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All maintenance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {others.length === 0 ? (
            <EmptyState
              title="Nothing to show"
              description="Work raised on your properties appears here, with its status and cost."
              icon={<Wrench className="size-8" />}
            />
          ) : (
            others.map((ticket) => (
              <div
                key={ticket.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{ticket.title}</p>
                  <p className="truncate text-xs text-[var(--muted-foreground)]">
                    {ticket.units?.properties?.name} · {ticket.units?.unit_number} ·{" "}
                    {formatDate(ticket.reported_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Money
                    amount={
                      ticket.final_amount_aed ??
                      ticket.approved_amount_aed ??
                      ticket.quoted_amount_aed
                    }
                    muted
                  />
                  <MaintenanceStatusBadge status={ticket.status} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
