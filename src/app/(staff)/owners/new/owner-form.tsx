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
import { createOwner, type ActionState } from "../actions";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];

export function OwnerForm({
  canEnterBankDetails,
}: {
  canEnterBankDetails: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(createOwner, {});
  const [isCompany, setIsCompany] = React.useState(false);

  React.useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="space-y-5">
      <FormError message={state.error} />

      <FormSection title="Identity">
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            name="isCompany"
            className="size-4"
            checked={isCompany}
            onChange={(e) => setIsCompany(e.target.checked)}
          />
          This owner is a company
        </label>

        <TextField
          name="fullName"
          label={isCompany ? "Company name" : "Full name"}
          required
          placeholder={isCompany ? "Horizon Capital Investments LLC" : "Ahmed Al Mansoori"}
        />
        {isCompany ? (
          <TextField
            name="companyTradeLicence"
            label="Trade licence number"
            placeholder="CN-2891044"
          />
        ) : (
          <TextField name="nationality" label="Nationality" placeholder="United Arab Emirates" />
        )}
        <TextField
          name="trn"
          label="TRN"
          placeholder="100234567800003"
          hint="Only if the owner is VAT registered."
        />
        <TextField
          name="countryOfResidence"
          label="Country of residence"
          hint="Overseas owners often need email rather than WhatsApp."
        />
      </FormSection>

      <FormSection title="Contact">
        <TextField name="email" label="Email" type="email" />
        <TextField name="phone" label="Phone" placeholder="+971501234567" />
        <TextField
          name="whatsapp"
          label="WhatsApp"
          placeholder="Defaults to the phone number"
        />
        <SelectField
          name="preferredChannel"
          label="Preferred channel"
          required
          defaultValue="whatsapp"
          options={CHANNELS}
        />
        <TextField name="addressLine" label="Address" wide />
      </FormSection>

      {!isCompany && (
        <FormSection
          title="Identification"
          description="Expiry dates feed the compliance calendar and the 60/30/7 day renewal alerts."
        >
          <TextField
            name="emiratesId"
            label="Emirates ID"
            placeholder="784-____-_______-_"
          />
          <TextField name="emiratesIdExpiry" label="Emirates ID expiry" type="date" />
          <TextField name="passportNumber" label="Passport number" />
          <TextField name="passportExpiry" label="Passport expiry" type="date" />
        </FormSection>
      )}

      {canEnterBankDetails && (
        <FormSection
          title="Payout details"
          description="Stored separately and visible only to finance and administrators. Payouts cannot be processed without them."
        >
          <TextField
            name="accountHolder"
            label="Account holder"
            hint="Defaults to the owner name."
          />
          <TextField name="bankName" label="Bank" placeholder="Emirates NBD" />
          <TextField
            name="iban"
            label="IBAN"
            placeholder="AE070331234567890123456"
          />
          <TextField name="swiftBic" label="SWIFT / BIC" placeholder="EBILAEAD" />
        </FormSection>
      )}

      <FormSection title="Notes" columns={1}>
        <TextAreaField name="notes" label="Internal notes" rows={3} />
      </FormSection>

      <SubmitBar label="Create owner" cancelHref="/owners" />
    </form>
  );
}
