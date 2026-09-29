"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

/** RLS filters rows silently: an update it refuses changes nothing and
 * reports no error, so a zero-row result is treated as refused. */
const NOT_CHANGED = "This owner could not be changed. You may not have access to them.";

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

export async function updateOwner(
  ownerId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "owners.manage")) {
    return { error: "You do not have permission to edit owners." };
  }
  if (!z.string().uuid().safeParse(ownerId).success) return { error: "Owner not found." };

  const parsed = ownerSchema.safeParse({
    ...Object.fromEntries(formData),
    isCompany: formData.get("isCompany") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  // A company has no personal ID documents, and an individual no trade
  // licence: switching type clears the fields the form no longer shows.
  const { data: changed, error } = await supabase
    .from("owners")
    .update({
      is_company: input.isCompany,
      full_name: input.fullName,
      company_trade_licence: input.isCompany ? input.companyTradeLicence || null : null,
      email: input.email || null,
      phone: input.phone || null,
      whatsapp: input.whatsapp || input.phone || null,
      nationality: input.isCompany ? null : input.nationality || null,
      emirates_id: input.isCompany ? null : input.emiratesId || null,
      emirates_id_expiry: input.isCompany ? null : input.emiratesIdExpiry || null,
      passport_number: input.isCompany ? null : input.passportNumber || null,
      passport_expiry: input.isCompany ? null : input.passportExpiry || null,
      trn: input.trn || null,
      address_line: input.addressLine || null,
      country_of_residence: input.countryOfResidence || null,
      preferred_channel: input.preferredChannel,
      notes: input.notes || null,
    })
    .eq("id", ownerId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  // Payout details change by replacement: the old account is deactivated, not
  // overwritten, so the account every past payout went to stays on record.
  if (can(profile.role, "owners.bank_details") && input.iban && input.bankName) {
    const { data: current } = await supabase
      .from("owner_bank_accounts")
      .select("id, account_holder, bank_name, iban, swift_bic")
      .eq("owner_id", ownerId)
      .eq("is_active", true)
      .eq("is_primary", true)
      .maybeSingle();

    const next = {
      account_holder: input.accountHolder || input.fullName,
      bank_name: input.bankName,
      iban: input.iban.replace(/\s+/g, "").toUpperCase(),
      swift_bic: input.swiftBic || null,
    };
    const changed =
      !current ||
      current.account_holder !== next.account_holder ||
      current.bank_name !== next.bank_name ||
      current.iban.replace(/\s+/g, "").toUpperCase() !== next.iban ||
      (current.swift_bic ?? null) !== next.swift_bic;

    if (changed) {
      if (current) {
        const { error: e } = await supabase
          .from("owner_bank_accounts")
          .update({ is_active: false })
          .eq("id", current.id);
        if (e) return { error: `Owner saved, but the bank account was not: ${e.message}` };
      }
      const { error: e } = await supabase
        .from("owner_bank_accounts")
        .insert({ owner_id: ownerId, ...next });
      if (e) return { error: `Owner saved, but the bank account was not: ${e.message}` };
    }
  }

  revalidatePath("/owners");
  revalidatePath(`/owners/${ownerId}`);
  redirect(`/owners/${ownerId}`);
}

const ownerIdSchema = z.object({ ownerId: z.string().uuid() });

export async function archiveOwner(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "owners.manage")) {
    return { error: "You do not have permission to archive owners." };
  }
  const parsed = ownerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Owner not found." };

  const supabase = await createClient();
  const { count } = await supabase
    .from("unit_ownerships")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", parsed.data.ownerId)
    .is("end_date", null);
  if (count) {
    return {
      error: `This owner still owns ${count} unit${count === 1 ? "" : "s"}. Change the owner on those units first.`,
    };
  }

  const { data: changed, error } = await supabase
    .from("owners")
    .update({ is_active: false })
    .eq("id", parsed.data.ownerId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/owners");
  revalidatePath(`/owners/${parsed.data.ownerId}`);
  return { success: "Owner archived." };
}

export async function restoreOwner(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "owners.manage")) {
    return { error: "You do not have permission to restore owners." };
  }
  const parsed = ownerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Owner not found." };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("owners")
    .update({ is_active: true })
    .eq("id", parsed.data.ownerId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/owners");
  revalidatePath(`/owners/${parsed.data.ownerId}`);
  return { success: "Owner restored." };
}

/**
 * Deletes an owner added by mistake. Any ownership (past or present),
 * statement, agreement, ledger line or document blocks it.
 */
export async function deleteOwner(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") {
    return { error: "Only a super admin can delete an owner permanently." };
  }
  const parsed = ownerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Owner not found." };
  const { ownerId } = parsed.data;

  const supabase = await createClient();

  // An ownership that ended the day it began was a correction (the wrong
  // owner picked on a unit, then changed), not history, so it does not
  // stop the owner being deleted and goes with them.
  const { data: ownerships, error: ownershipsError } = await supabase
    .from("unit_ownerships")
    .select("id, start_date, end_date")
    .eq("owner_id", ownerId);
  if (ownershipsError) return { error: ownershipsError.message };
  const corrections = (ownerships ?? [])
    .filter((o) => o.end_date !== null && o.end_date <= o.start_date)
    .map((o) => o.id);

  const history = [
    ["owner_statements", "statements"],
    ["management_agreements", "management agreements"],
    ["ledger_entries", "ledger transactions"],
    ["documents", "documents"],
  ] as const;
  const counts = await Promise.all(
    history.map(([table]) =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("owner_id", ownerId)
    )
  );
  const failed = counts.find((c) => c.error);
  if (failed?.error) return { error: failed.error.message };

  const blocking = [
    (ownerships ?? []).length - corrections.length > 0 ? "units (now or in the past)" : null,
    ...history.map(([, label], i) => ((counts[i].count ?? 0) > 0 ? label : null)),
  ].filter(Boolean);
  if (blocking.length) {
    return {
      error: `This owner has ${blocking.join(", ")} on file, so they cannot be deleted. Archive them instead.`,
    };
  }

  if (corrections.length) {
    const { error: cleanupError } = await supabase
      .from("unit_ownerships")
      .delete()
      .in("id", corrections);
    if (cleanupError) return { error: cleanupError.message };
  }

  const { data: changed, error } = await supabase
    .from("owners")
    .delete()
    .eq("id", ownerId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/owners");
  redirect("/owners");
}
