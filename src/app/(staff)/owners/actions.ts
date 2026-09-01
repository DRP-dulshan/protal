"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export type ActionState = { error?: string; success?: string };

const ownerSchema = z.object({
  isCompany: z.boolean().default(false),
  fullName: z.string().min(2, "Name is required").max(160),
  companyTradeLicence: z.string().max(60).optional(),
  email: z.string().email("Enter a valid email").or(z.literal("")).optional(),
  phone: z.string().max(30).optional(),
  whatsapp: z.string().max(30).optional(),
  nationality: z.string().max(60).optional(),
  emiratesId: z.string().max(30).optional(),
  emiratesIdExpiry: z.string().optional(),
  passportNumber: z.string().max(30).optional(),
  passportExpiry: z.string().optional(),
  trn: z.string().max(30).optional(),
  addressLine: z.string().max(250).optional(),
  countryOfResidence: z.string().max(60).optional(),
  preferredChannel: z.enum(["whatsapp", "email", "sms", "in_app"]),
  // Payout details are optional here; finance can add them later.
  accountHolder: z.string().max(120).optional(),
  bankName: z.string().max(120).optional(),
  iban: z.string().max(40).optional(),
  swiftBic: z.string().max(20).optional(),
  notes: z.string().max(1000).optional(),
});

export async function createOwner(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "owners.manage")) {
    return { error: "You do not have permission to add owners." };
  }

  const parsed = ownerSchema.safeParse({
    ...Object.fromEntries(formData),
    isCompany: formData.get("isCompany") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const supabase = await createClient();

  const { data: owner, error } = await supabase
    .from("owners")
    .insert({
      is_company: input.isCompany,
      full_name: input.fullName,
      company_trade_licence: input.companyTradeLicence || null,
      email: input.email || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || input.phone || null,
      nationality: input.nationality || null,
      emirates_id: input.emiratesId || null,
      emirates_id_expiry: input.emiratesIdExpiry || null,
      passport_number: input.passportNumber || null,
      passport_expiry: input.passportExpiry || null,
      trn: input.trn || null,
      address_line: input.addressLine || null,
      country_of_residence: input.countryOfResidence || null,
      preferred_channel: input.preferredChannel,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Bank details go in their own table so RLS can restrict them to finance.
  if (input.iban && input.bankName) {
    const { error: bankError } = await supabase.from("owner_bank_accounts").insert({
      owner_id: owner.id,
      account_holder: input.accountHolder || input.fullName,
      bank_name: input.bankName,
      iban: input.iban,
      swift_bic: input.swiftBic || null,
    });

    if (bankError) {
      return {
        error: `Owner created, but the bank account failed: ${bankError.message}`,
      };
    }
  }

  revalidatePath("/owners");
  redirect(`/owners/${owner.id}`);
}
