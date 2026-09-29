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
import { createUnit, updateUnit, type ActionState } from "../actions";
import type { Tables } from "@/lib/db/database.types";
import {
  UNIT_KIND,
  FURNISHING,
  OPERATING_MODE,
  optionsFrom,
} from "@/lib/labels";

/** Today's owner of a unit being edited; "shared" when it has several. */
export type CurrentOwnership = { ownerId: string; pct: number } | "shared" | null;

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function UnitForm({
  properties,
  owners,
  defaultPropertyId,
  unit,
  ownership = null,
}: {
  properties: { id: string; label: string }[];
  owners: { id: string; full_name: string }[];
  defaultPropertyId?: string;
  /** Present when editing; the form is prefilled from it. */
  unit?: Tables<"units">;
  ownership?: CurrentOwnership;
}) {
  const submit = React.useMemo(
    () => (unit ? updateUnit.bind(null, unit.id) : createUnit),
    [unit]
  );
  const [state, action] = useActionState<ActionState, FormData>(submit, {});
  const [mode, setMode] = React.useState<string>(unit?.operating_mode ?? "long_term");

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const showNightly = mode === "short_term" || mode === "both";
  const showAnnual = mode === "long_term" || mode === "both";

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormSection title="Location">
        <SelectField
          name="propertyId"
          label="Property"
          required
          defaultValue={unit?.property_id ?? defaultPropertyId ?? ""}
          placeholder="Select a property"
          options={properties.map((p) => ({ value: p.id, label: p.label }))}
          hint={
            properties.length === 0
              ? "No properties yet — add one first."
              : undefined
          }
        />
        <TextField
          name="unitNumber"
          label="Unit number"
          required
          placeholder="1204"
          defaultValue={str(unit?.unit_number)}
        />
        <TextField
          name="referenceCode"
          label="Internal reference"
          placeholder="DRP-MG1-1204"
          hint="Optional D|R|P code, unique across the portfolio."
          defaultValue={str(unit?.reference_code)}
        />
        <TextField name="floor" label="Floor" placeholder="12" defaultValue={str(unit?.floor)} />
      </FormSection>

      <FormSection title="Specification" columns={3}>
        <SelectField
          name="kind"
          label="Type"
          required
          defaultValue={unit?.kind ?? "apartment"}
          options={optionsFrom(UNIT_KIND)}
        />
        <TextField
          name="bedrooms"
          label="Bedrooms"
          type="number"
          step="0.5"
          min="0"
          required
          defaultValue={unit ? str(unit.bedrooms) : "1"}
          hint="Use 0 for a studio."
        />
        <TextField
          name="bathrooms"
          label="Bathrooms"
          type="number"
          step="0.5"
          min="0"
          required
          defaultValue={unit ? str(unit.bathrooms) : "1"}
        />
        <TextField
          name="sizeSqft"
          label="Size (sqft)"
          type="number"
          step="0.01"
          min="0"
          hint="Square metres are derived automatically."
          defaultValue={str(unit?.size_sqft)}
        />
        <SelectField
          name="furnishing"
          label="Furnishing"
          required
          defaultValue={unit?.furnishing ?? "unfurnished"}
          options={optionsFrom(FURNISHING)}
        />
        <TextField
          name="parkingSpaces"
          label="Parking spaces"
          type="number"
          min="0"
          defaultValue={unit ? str(unit.parking_spaces) : "0"}
        />
        <TextField
          name="viewDescription"
          label="View"
          placeholder="Marina and sea view"
          defaultValue={str(unit?.view_description)}
        />
      </FormSection>

      <FormSection
        title="Dubai identifiers"
        description="Used for DEWA connection, Ejari registration and service charge reconciliation."
      >
        <TextField
          name="dewaPremiseNumber"
          label="DEWA premise number"
          placeholder="3610234567"
          defaultValue={str(unit?.dewa_premise_number)}
        />
        <TextField
          name="titleDeedNumber"
          label="Title deed number"
          placeholder="2019-1-234567"
          defaultValue={str(unit?.title_deed_number)}
        />
        <TextField
          name="makaniNumber"
          label="Makani number"
          placeholder="2648770179"
          defaultValue={str(unit?.makani_number)}
        />
        <TextField
          name="mollakUnitId"
          label="Mollak unit ID"
          placeholder="MOL-U-11204"
          defaultValue={str(unit?.mollak_unit_id)}
        />
      </FormSection>

      <FormSection title="Operating mode and pricing">
        <SelectField
          name="operatingMode"
          label="Operating mode"
          required
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          options={optionsFrom(OPERATING_MODE)}
          hint="Holiday home mode requires a valid DET permit before the unit can be listed or booked."
        />
        <div />
        {showAnnual && (
          <TextField
            name="targetAnnualRent"
            label="Target annual rent (AED)"
            type="number"
            step="0.01"
            min="0"
            placeholder="145000"
            defaultValue={str(unit?.target_annual_rent_aed)}
          />
        )}
        {showNightly && (
          <TextField
            name="baseNightlyRate"
            label="Base nightly rate (AED)"
            type="number"
            step="0.01"
            min="0"
            placeholder="720"
            defaultValue={str(unit?.base_nightly_rate_aed)}
          />
        )}
      </FormSection>

      <FormSection
        title="Ownership"
        description="A unit with no owner cannot be billed or reported on, and will not appear in any owner portal."
      >
        {ownership === "shared" ? (
          <p className="text-sm text-[var(--muted-foreground)] sm:col-span-2">
            This unit has more than one owner, so ownership is not changed here.
          </p>
        ) : (
          <>
            <SelectField
              name="ownerId"
              label="Owner"
              placeholder={unit ? "No owner" : "Link later"}
              defaultValue={ownership?.ownerId ?? ""}
              options={owners.map((o) => ({ value: o.id, label: o.full_name }))}
              hint={
                unit
                  ? "Choosing a different owner ends the current ownership today and keeps it as history."
                  : undefined
              }
            />
            <TextField
              name="ownershipPct"
              label="Ownership share (%)"
              type="number"
              step="0.01"
              min="0.01"
              max="100"
              defaultValue={ownership ? str(ownership.pct) : "100"}
              hint="Shares across owners of one unit cannot exceed 100%."
            />
          </>
        )}
        <TextAreaField name="notes" label="Notes" rows={3} defaultValue={str(unit?.notes)} />
      </FormSection>

      <SubmitBar
        label={unit ? "Save changes" : "Create unit"}
        cancelHref={unit ? `/units/${unit.id}` : "/units"}
      />
    </form>
  );
}
