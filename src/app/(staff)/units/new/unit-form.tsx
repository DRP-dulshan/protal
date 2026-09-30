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
  // "__new" adds the building together with the unit.
  const [propertyChoice, setPropertyChoice] = React.useState<string>(
    unit?.property_id ?? defaultPropertyId ?? (properties.length === 0 ? "__new" : "")
  );

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
          label="Building / property"
          required
          value={propertyChoice}
          onChange={(e) => setPropertyChoice(e.target.value)}
          placeholder="Select a building"
          options={[
            ...properties.map((p) => ({ value: p.id, label: p.label })),
            { value: "__new", label: "+ New building (not in the list)" },
          ]}
          hint="Not in the list? Choose + New building and type its name here."
        />
        {propertyChoice === "__new" && (
          <>
            <TextField
              name="newPropertyName"
              label="New building name"
              required
              maxLength={120}
              placeholder="e.g. Azizi Riviera 12"
            />
            <TextField
              name="newPropertyArea"
              label="Area / community"
              maxLength={80}
              placeholder="e.g. Meydan"
            />
            <SelectField
              name="newPropertyKind"
              label="Building type"
              defaultValue="building"
              options={[
                { value: "building", label: "Apartment building" },
                { value: "villa_compound", label: "Villa compound" },
                { value: "standalone_villa", label: "Standalone villa" },
                { value: "townhouse_cluster", label: "Townhouses" },
                { value: "mixed_use", label: "Mixed use" },
              ]}
            />
          </>
        )}
        <TextField
          name="unitNumber"
          label="Unit number"
          required
          placeholder="e.g. 1204"
          defaultValue={str(unit?.unit_number)}
        />
        <TextField
          name="referenceCode"
          label="Internal reference"
          placeholder="e.g. DRP-MG1-1204"
          hint="Optional D|R|P code, unique across the portfolio."
          defaultValue={str(unit?.reference_code)}
        />
        <TextField name="floor" label="Floor" placeholder="e.g. 12" defaultValue={str(unit?.floor)} />
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
          placeholder="e.g. Marina and sea view"
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
          placeholder="e.g. 3610234567"
          defaultValue={str(unit?.dewa_premise_number)}
        />
        <TextField
          name="titleDeedNumber"
          label="Title deed number"
          placeholder="e.g. 2019-1-234567"
          defaultValue={str(unit?.title_deed_number)}
        />
        <TextField
          name="makaniNumber"
          label="Makani number"
          placeholder="e.g. 2648770179"
          defaultValue={str(unit?.makani_number)}
        />
        <TextField
          name="mollakUnitId"
          label="Mollak unit ID"
          placeholder="e.g. MOL-U-11204"
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
            placeholder="e.g. 145000"
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
            placeholder="e.g. 720"
            defaultValue={str(unit?.base_nightly_rate_aed)}
            hint="Sunday to Thursday nights."
          />
        )}
        {showNightly && (
          <>
            <TextField
              name="weekendRate"
              label="Weekend rate (AED)"
              type="number"
              step="0.01"
              min="0"
              placeholder="Same as nightly"
              defaultValue={str(unit?.weekend_rate_aed)}
              hint="Friday and Saturday nights."
            />
            <TextField
              name="cleaningFee"
              label="Cleaning fee (AED)"
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 0"
              defaultValue={str(unit?.cleaning_fee_aed)}
              hint="Once per stay."
            />
            <TextField
              name="weeklyDiscount"
              label="Weekly discount (%)"
              type="number"
              step="0.01"
              min="0"
              max="99"
              placeholder="e.g. 0"
              defaultValue={str(unit?.weekly_discount_pct)}
              hint="Stays of 7 nights or more."
            />
            <TextField
              name="monthlyDiscount"
              label="Monthly discount (%)"
              type="number"
              step="0.01"
              min="0"
              max="99"
              placeholder="e.g. 0"
              defaultValue={str(unit?.monthly_discount_pct)}
              hint="Stays of 28 nights or more."
            />
          </>
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
