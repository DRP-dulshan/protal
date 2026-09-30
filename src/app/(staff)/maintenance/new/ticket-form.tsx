"use client";

import { useActionState } from "react";
import { FormError, FormSection, SelectField, SubmitBar } from "@/components/domain/form";
import { TicketFields } from "@/components/domain/ticket-fields";
import type { TicketKind } from "@/lib/labels";
import { createTicket, type ActionState } from "../actions";

const REPORTED_BY = [
  { value: "tenant", label: "Tenant" },
  { value: "guest", label: "Holiday home guest" },
  { value: "owner", label: "Owner" },
  { value: "staff", label: "D|R|P staff (found it ourselves)" },
];

export function TicketForm({
  units,
  defaultUnitId,
  defaultKind,
}: {
  units: { id: string; label: string }[];
  defaultUnitId?: string;
  defaultKind: TicketKind;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createTicket, {});

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection title="Where and who">
        <SelectField
          name="unitId"
          label="Unit"
          required
          defaultValue={units.some((u) => u.id === defaultUnitId) ? defaultUnitId : ""}
          placeholder="Choose the unit"
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
        <SelectField name="reportedBy" label="Reported by" required defaultValue="tenant" options={REPORTED_BY} />
      </FormSection>
      <FormSection title="The issue">
        <TicketFields defaultKind={defaultKind} />
      </FormSection>
      <SubmitBar label="Create ticket" pendingLabel="Creating…" cancelHref="/maintenance" />
    </form>
  );
}
