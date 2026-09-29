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
import { createOwner, updateOwner, type ActionState } from "../actions";
import type { Tables } from "@/lib/db/database.types";

const CHANNELS = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];

const str = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

type Bank = Pick<Tables<"owner_bank_accounts">, "account_holder" | "bank_name" | "iban" | "swift_bic">;

export function OwnerForm({
  canEnterBankDetails,
  owner,
  bank,
}: {
  canEnterBankDetails: boolean;
  /** Present when editing; the form is prefilled from it. */
  owner?: Tables<"owners">;
  bank?: Bank | null;
}) {
  const submit = React.useMemo(
    () => (owner ? updateOwner.bind(null, owner.id) : createOwner),
    [owner]
  );
  const [state, action] = useActionState<ActionState, FormData>(submit, {});
  const [isCompany, setIsCompany] = React.useState(owner?.is_company ?? false);

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
          defaultValue={str(owner?.full_name)}
        />
        {isCompany ? (
          <TextField
            name="companyTradeLicence"
            label="Trade licence number"
            placeholder="CN-2891044"
            defaultValue={str(owner?.company_trade_licence)}
          />
        ) : (
          <TextField
            name="nationality"
            label="Nationality"
            placeholder="United Arab Emirates"
            defaultValue={str(owner?.nationality)}
          />
        )}
        <TextField
          name="trn"
          label="TRN"
          placeholder="100234567800003"
          hint="Only if the owner is VAT registered."
          defaultValue={str(owner?.trn)}
        />
        <TextField
          name="countryOfResidence"
          label="Country of residence"
          hint="Overseas owners often need email rather than WhatsApp."
          defaultValue={str(owner?.country_of_residence)}
        />
      </FormSection>

      <FormSection title="Contact">
        <TextField name="email" label="Email" type="email" defaultValue={str(owner?.email)} />
        <TextField
          name="phone"
          label="Phone"
          placeholder="+971501234567"
          defaultValue={str(owner?.phone)}
        />
        <TextField
          name="whatsapp"
          label="WhatsApp"
          placeholder="Defaults to the phone number"
          defaultValue={str(owner?.whatsapp)}
        />
        <SelectField
          name="preferredChannel"
          label="Preferred channel"
          required
          defaultValue={owner?.preferred_channel ?? "whatsapp"}
          options={CHANNELS}
        />
        <TextField name="addressLine" label="Address" wide defaultValue={str(owner?.address_line)} />
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
            defaultValue={str(owner?.emirates_id)}
          />
          <TextField
            name="emiratesIdExpiry"
            label="Emirates ID expiry"
            type="date"
            defaultValue={str(owner?.emirates_id_expiry)}
          />
          <TextField
            name="passportNumber"
            label="Passport number"
            defaultValue={str(owner?.passport_number)}
          />
          <TextField
            name="passportExpiry"
            label="Passport expiry"
            type="date"
            defaultValue={str(owner?.passport_expiry)}
          />
        </FormSection>
      )}

      {canEnterBankDetails && (
        <FormSection
          title="Payout details"
          description={
            owner
              ? "Changing these replaces the payout account; the previous one is kept on record."
              : "Stored separately and visible only to finance and administrators. Payouts cannot be processed without them."
          }
        >
          <TextField
            name="accountHolder"
            label="Account holder"
            hint="Defaults to the owner name."
            defaultValue={str(bank?.account_holder)}
          />
          <TextField
            name="bankName"
            label="Bank"
            placeholder="Emirates NBD"
            defaultValue={str(bank?.bank_name)}
          />
          <TextField
            name="iban"
            label="IBAN"
            placeholder="AE070331234567890123456"
            defaultValue={str(bank?.iban)}
          />
          <TextField
            name="swiftBic"
            label="SWIFT / BIC"
            placeholder="EBILAEAD"
            defaultValue={str(bank?.swift_bic)}
          />
        </FormSection>
      )}

      <FormSection title="Notes" columns={1}>
        <TextAreaField
          name="notes"
          label="Internal notes"
          rows={3}
          defaultValue={str(owner?.notes)}
        />
      </FormSection>

      <SubmitBar
        label={owner ? "Save changes" : "Create owner"}
        cancelHref={owner ? `/owners/${owner.id}` : "/owners"}
      />
    </form>
  );
}
