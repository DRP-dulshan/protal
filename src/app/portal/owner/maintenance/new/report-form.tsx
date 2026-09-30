"use client";

import { useActionState } from "react";
import { FormError, FormSection, SelectField, SubmitBar } from "@/components/domain/form";
import { TicketFields } from "@/components/domain/ticket-fields";
import { reportIssue, type ActionState } from "../actions";

export function ReportForm({
  units,
  defaultUnitId,
}: {
  units: { id: string; label: string }[];
  defaultUnitId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(reportIssue, {});
  const only = units.length === 1 ? units[0].id : undefined;

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />
      <FormSection title="Which property">
        <SelectField
          name="unitId"
          label="Property"
          required
          wide
          defaultValue={only ?? (units.some((u) => u.id === defaultUnitId) ? defaultUnitId : "")}
          placeholder={only ? undefined : "Choose the property"}
          options={units.map((u) => ({ value: u.id, label: u.label }))}
        />
      </FormSection>
      <FormSection title="What is the issue">
        <TicketFields />
      </FormSection>
      <SubmitBar label="Send to D|R|P" pendingLabel="Sending…" cancelHref="/portal/owner/maintenance" />
    </form>
  );
}
