"use client";

import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import {
  FormSection,
  TextField,
  SelectField,
  SubmitBar,
  FormError,
} from "@/components/domain/form";
import { createProperty, type ActionState } from "../../units/actions";
import { updateProperty } from "../actions";
import { PROPERTY_KIND, EMIRATE, optionsFrom } from "@/lib/labels";
import type { Enums, Tables } from "@/lib/db/database.types";

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function PropertyForm({
  communities,
  property,
}: {
  communities: { id: string; name: string; emirate: Enums<"emirate"> }[];
  /** Present when editing; the form is prefilled from it. */
  property?: Tables<"properties">;
}) {
  const submit = React.useMemo(
    () => (property ? updateProperty.bind(null, property.id) : createProperty),
    [property]
  );
  const [state, action] = useActionState<ActionState, FormData>(submit, {});
  const [communityId, setCommunityId] = React.useState(property?.community_id ?? "");
  const currentEmirate = communities.find((c) => c.id === property?.community_id)?.emirate;

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormSection title="Identity">
        <TextField
          name="name"
          label="Property name"
          required
          placeholder="Marina Gate 1"
          defaultValue={str(property?.name)}
        />
        <SelectField
          name="kind"
          label="Type"
          required
          defaultValue={property?.kind ?? "building"}
          options={optionsFrom(PROPERTY_KIND)}
        />
        <SelectField
          name="communityId"
          label="Community"
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          placeholder="Add a new community"
          options={communities.map((c) => ({
            value: c.id,
            label: `${c.name} — ${EMIRATE[c.emirate]}`,
          }))}
        />
        {!communityId && (
          <TextField
            name="newCommunity"
            label="New community name"
            placeholder="Dubai Marina"
            hint="Created if it does not already exist in the selected emirate."
          />
        )}
        <SelectField
          name="emirate"
          label="Emirate"
          required
          defaultValue={currentEmirate ?? "dubai"}
          options={optionsFrom(EMIRATE)}
        />
        <TextField
          name="developerName"
          label="Developer"
          placeholder="Emaar Properties"
          defaultValue={str(property?.developer_name)}
        />
        <TextField
          name="addressLine"
          label="Address"
          wide
          defaultValue={str(property?.address_line)}
        />
        <TextField
          name="makaniNumber"
          label="Makani number"
          defaultValue={str(property?.makani_number)}
        />
      </FormSection>

      <FormSection title="Scale" columns={2}>
        <TextField
          name="floors"
          label="Floors"
          type="number"
          min="0"
          defaultValue={str(property?.floors)}
        />
        <TextField
          name="totalUnits"
          label="Total units in the building"
          type="number"
          min="0"
          hint="The whole building, not just those D|R|P manages."
          defaultValue={str(property?.total_units)}
        />
      </FormSection>

      <FormSection
        title="Owners association"
        description="Service charges are invoiced through Mollak and recharged to owners."
      >
        <TextField
          name="ownersAssociationName"
          label="Owners association"
          placeholder="Marina Gate Owners Association"
          defaultValue={str(property?.owners_association_name)}
        />
        <TextField
          name="mollakPropertyId"
          label="Mollak property ID"
          placeholder="MOL-DXB-99231"
          defaultValue={str(property?.mollak_property_id)}
        />
      </FormSection>

      <SubmitBar label={property ? "Save changes" : "Create property"} cancelHref="/properties" />
    </form>
  );
}
