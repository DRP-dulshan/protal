"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import {
  FormSection,
  TextField,
  SelectField,
  TextAreaField,
  SubmitBar,
  FormError,
} from "@/components/domain/form";
import { Callout } from "@/components/domain/shared";
import { createLease, type ActionState } from "../actions";
import { PAYMENT_METHOD, optionsFrom } from "@/lib/labels";
import { formatAED } from "@/lib/money";

/** Dubai convention: rent is split into 1, 2, 4, 6 or 12 cheques. */
const INSTALLMENT_OPTIONS = [
  { value: "1", label: "1 cheque (annual)" },
  { value: "2", label: "2 cheques (6-monthly)" },
  { value: "3", label: "3 cheques (4-monthly)" },
  { value: "4", label: "4 cheques (quarterly)" },
  { value: "6", label: "6 cheques (2-monthly)" },
  { value: "12", label: "12 cheques (monthly)" },
];

type Unit = {
  id: string;
  label: string;
  targetRent: number | null;
  occupied: boolean;
};

export function LeaseForm({
  units,
  tenants,
  defaultUnitId,
  noticeDays,
}: {
  units: Unit[];
  tenants: { id: string; full_name: string; is_company: boolean }[];
  defaultUnitId?: string;
  noticeDays: number;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createLease, {});
  const [unitId, setUnitId] = React.useState(defaultUnitId ?? "");
  const [rent, setRent] = React.useState("");
  const [installments, setInstallments] = React.useState("4");
  const [startDate, setStartDate] = React.useState("");

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const selectedUnit = units.find((u) => u.id === unitId);

  // Prefill the rent from the unit's target when the manager has not typed one.
  React.useEffect(() => {
    if (selectedUnit?.targetRent && !rent) {
      setRent(String(selectedUnit.targetRent));
    }
    // Only react to the unit changing; typing over the value must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitId]);

  const rentValue = Number(rent) || 0;
  const count = Number(installments) || 1;
  const perCheque = rentValue / count;

  // A 12-month default term matches the standard Dubai tenancy contract.
  const endDate = React.useMemo(() => {
    if (!startDate) return "";
    const d = new Date(startDate);
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [startDate]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormSection title="Parties">
        <SelectField
          name="unitId"
          label="Unit"
          required
          value={unitId}
          onChange={(e) => setUnitId(e.target.value)}
          placeholder="Select a unit"
          options={units.map((u) => ({
            value: u.id,
            label: u.occupied ? `${u.label} (currently occupied)` : u.label,
          }))}
        />
        <SelectField
          name="tenantId"
          label="Tenant"
          required
          placeholder={
            tenants.length === 0 ? "No tenants on file yet" : "Select a tenant"
          }
          options={tenants.map((t) => ({
            value: t.id,
            label: t.is_company ? `${t.full_name} (company)` : t.full_name,
          }))}
          hint="Tenants are added from the tenancy record or the CRM."
        />
      </FormSection>

      {selectedUnit?.occupied && (
        <Callout tone="warning" title="This unit already has a live tenancy">
          Overlapping contracts are rejected by the database. Terminate or adjust
          the existing tenancy first, or set dates that begin after it ends.
        </Callout>
      )}

      <FormSection title="Term">
        <TextField
          name="startDate"
          label="Start date"
          type="date"
          required
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <TextField
          name="endDate"
          label="End date"
          type="date"
          required
          defaultValue={endDate}
          key={endDate}
          hint="Defaults to a 12-month term."
        />
        <TextField
          name="annualRent"
          label="Annual rent (AED)"
          type="number"
          step="0.01"
          min="0"
          required
          value={rent}
          onChange={(e) => setRent(e.target.value)}
        />
        <TextField
          name="securityDeposit"
          label="Security deposit (AED)"
          type="number"
          step="0.01"
          min="0"
          defaultValue="0"
          hint="Typically 5% unfurnished, 10% furnished."
        />
      </FormSection>

      <FormSection title="Payment schedule">
        <SelectField
          name="paymentMethod"
          label="Payment method"
          required
          defaultValue="cheque"
          options={optionsFrom(PAYMENT_METHOD)}
        />
        <SelectField
          name="installmentCount"
          label="Number of payments"
          required
          value={installments}
          onChange={(e) => setInstallments(e.target.value)}
          options={INSTALLMENT_OPTIONS}
        />
        {rentValue > 0 && (
          <p className="text-sm text-[var(--muted-foreground)] sm:col-span-2">
            {count} × {formatAED(perCheque)} — the schedule is generated on save,
            with any rounding difference placed on the first payment.
          </p>
        )}
        <TextField
          name="agencyFee"
          label="Agency fee (AED)"
          type="number"
          step="0.01"
          min="0"
        />
        <TextField
          name="ejariFee"
          label="Ejari fee (AED)"
          type="number"
          step="0.01"
          min="0"
          placeholder="220"
        />
      </FormSection>

      <FormSection
        title="Ejari registration"
        description="Leave blank if registration is still pending — the tenancy will show as a compliance breach until it is recorded."
      >
        <TextField
          name="ejariContractNumber"
          label="Ejari contract number"
          placeholder="EJ-2026-0099231"
        />
        <TextField name="ejariRegisteredOn" label="Registered on" type="date" />
        <TextField
          name="ejariExpiry"
          label="Ejari expiry"
          type="date"
          hint={`Renewal notices are due ${noticeDays} days before expiry.`}
        />
        <TextAreaField name="notes" label="Notes" rows={3} />
      </FormSection>

      <SubmitBar
        label="Create tenancy and schedule"
        pendingLabel="Creating…"
        cancelHref="/leases"
      />
    </form>
  );
}
