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
import { PROPERTY_KIND, EMIRATE, optionsFrom } from "@/lib/labels";
import type { Enums } from "@/lib/db/database.types";

export function PropertyForm({
  communities,
}: {
  communities: { id: string; name: string; emirate: Enums<"emirate"> }[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(createProperty, {});
  const [communityId, setCommunityId] = React.useState("");

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
        />
        <SelectField
          name="kind"
          label="Type"
          required
          defaultValue="building"
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
          defaultValue="dubai"
          options={optionsFrom(EMIRATE)}
        />
        <TextField name="developerName" label="Developer" placeholder="Emaar Properties" />
        <TextField name="addressLine" label="Address" wide />
        <TextField name="makaniNumber" label="Makani number" />
      </FormSection>

      <FormSection title="Scale" columns={2}>
        <TextField name="floors" label="Floors" type="number" min="0" />
        <TextField
          name="totalUnits"
          label="Total units in the building"
          type="number"
          min="0"
          hint="The whole building, not just those D|R|P manages."
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
        />
        <TextField
          name="mollakPropertyId"
          label="Mollak property ID"
          placeholder="MOL-DXB-99231"
        />
      </FormSection>

      <SubmitBar label="Create property" cancelHref="/properties" />
    </form>
  );
}
