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
import { createUnit, type ActionState } from "../actions";
import {
  UNIT_KIND,
  FURNISHING,
  OPERATING_MODE,
  optionsFrom,
} from "@/lib/labels";

export function UnitForm({
  properties,
  owners,
  defaultPropertyId,
}: {
  properties: { id: string; label: string }[];
  owners: { id: string; full_name: string }[];
  defaultPropertyId?: string;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createUnit, {});
  const [mode, setMode] = React.useState<string>("long_term");

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
          defaultValue={defaultPropertyId ?? ""}
          placeholder="Select a property"
          options={properties.map((p) => ({ value: p.id, label: p.label }))}
          hint={
            properties.length === 0
              ? "No properties yet — add one first."
              : undefined
          }
        />
        <TextField name="unitNumber" label="Unit number" required placeholder="1204" />
        <TextField
          name="referenceCode"
          label="Internal reference"
          placeholder="DRP-MG1-1204"
          hint="Optional D|R|P code, unique across the portfolio."
        />
        <TextField name="floor" label="Floor" placeholder="12" />
      </FormSection>

      <FormSection title="Specification" columns={3}>
        <SelectField
          name="kind"
          label="Type"
          required
          defaultValue="apartment"
          options={optionsFrom(UNIT_KIND)}
        />
        <TextField
          name="bedrooms"
          label="Bedrooms"
          type="number"
          step="0.5"
          min="0"
          required
          defaultValue="1"
          hint="Use 0 for a studio."
        />
        <TextField
          name="bathrooms"
          label="Bathrooms"
          type="number"
          step="0.5"
          min="0"
          required
          defaultValue="1"
        />
        <TextField
          name="sizeSqft"
          label="Size (sqft)"
          type="number"
          step="0.01"
          min="0"
          hint="Square metres are derived automatically."
        />
        <SelectField
          name="furnishing"
          label="Furnishing"
          required
          defaultValue="unfurnished"
          options={optionsFrom(FURNISHING)}
        />
        <TextField
          name="parkingSpaces"
          label="Parking spaces"
          type="number"
          min="0"
          defaultValue="0"
        />
        <TextField
          name="viewDescription"
          label="View"
          placeholder="Marina and sea view"
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
        />
        <TextField
          name="titleDeedNumber"
          label="Title deed number"
          placeholder="2019-1-234567"
        />
        <TextField name="makaniNumber" label="Makani number" placeholder="2648770179" />
        <TextField name="mollakUnitId" label="Mollak unit ID" placeholder="MOL-U-11204" />
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
          />
        )}
      </FormSection>

      <FormSection
        title="Ownership"
        description="A unit with no owner cannot be billed or reported on, and will not appear in any owner portal."
      >
        <SelectField
          name="ownerId"
          label="Owner"
          placeholder="Link later"
          options={owners.map((o) => ({ value: o.id, label: o.full_name }))}
        />
        <TextField
          name="ownershipPct"
          label="Ownership share (%)"
          type="number"
          step="0.01"
          min="0.01"
          max="100"
          defaultValue="100"
          hint="Shares across owners of one unit cannot exceed 100%."
        />
        <TextAreaField name="notes" label="Notes" rows={3} />
      </FormSection>

      <SubmitBar label="Create unit" cancelHref="/units" />
    </form>
  );
}
