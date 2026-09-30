"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { FormError, SelectField, SubmitBar, TextAreaField, TextField } from "@/components/domain/form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MAINTENANCE_PRIORITY, MAINTENANCE_STATUS, optionsFrom } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";
import { changeTicketStatus, updateTicketDetails, type ActionState } from "../actions";

const COST_BEARER = [
  { value: "owner", label: "Owner" },
  { value: "tenant", label: "Tenant" },
  { value: "drp", label: "D|R|P" },
  { value: "insurance", label: "Insurance" },
  { value: "warranty", label: "Warranty" },
];

function useToast(state: ActionState) {
  React.useEffect(() => {
    if (state.success) toast.success(state.success);
  }, [state]);
}

export function StatusCard({
  ticketId,
  status,
}: {
  ticketId: string;
  status: Enums<"maintenance_status">;
}) {
  const [state, action] = useActionState<ActionState, FormData>(changeTicketStatus.bind(null, ticketId), {});
  useToast(state);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Status</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3">
          <FormError message={state.error} />
          <SelectField
            key={status}
            name="status"
            label="Move to"
            defaultValue={status}
            options={optionsFrom(MAINTENANCE_STATUS)}
          />
          <TextAreaField name="note" label="Note (optional)" rows={2} maxLength={2000} placeholder="Shown on the timeline" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="internal" />
            Keep the note internal
          </label>
          <SubmitBar label="Update status" pendingLabel="Updating…" />
          <p className="text-xs text-[var(--muted-foreground)]">
            The owner is told of every status change in their portal.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

export function DetailsCard({
  ticketId,
  staff,
  current,
}: {
  ticketId: string;
  staff: { id: string; name: string }[];
  current: {
    priority: string;
    assignedTo: string | null;
    scheduledFor: string | null;
    quoted: number | null;
    final: number | null;
    costBorneBy: string;
    resolution: string | null;
  };
}) {
  const [state, action] = useActionState<ActionState, FormData>(updateTicketDetails.bind(null, ticketId), {});
  useToast(state);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Handling</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FormError message={state.error} />
          </div>
          <SelectField name="priority" label="Priority" defaultValue={current.priority} options={optionsFrom(MAINTENANCE_PRIORITY)} />
          <SelectField
            name="assignedTo"
            label="Assigned to"
            defaultValue={current.assignedTo ?? ""}
            placeholder="Nobody yet"
            options={staff.map((s) => ({ value: s.id, label: s.name }))}
          />
          <TextField name="scheduledFor" label="Visit date" type="date" defaultValue={current.scheduledFor ?? ""} />
          <SelectField name="costBorneBy" label="Cost paid by" defaultValue={current.costBorneBy} options={COST_BEARER} />
          <TextField
            name="quotedAmount"
            label="Quote (AED)"
            type="number"
            min={0}
            step="0.01"
            defaultValue={current.quoted ?? ""}
            hint="Above the owner-approval limit, the owner must approve first."
          />
          <TextField name="finalAmount" label="Final cost (AED)" type="number" min={0} step="0.01" defaultValue={current.final ?? ""} />
          <TextAreaField name="resolutionNotes" label="Resolution" rows={2} maxLength={2000} defaultValue={current.resolution ?? ""} />
          <div className="sm:col-span-2">
            <SubmitBar label="Save" />
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
