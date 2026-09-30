"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dubaiToday } from "@/lib/calendar";
import { propertySchema } from "../properties/schema";
import { parseOwnerShares, planOwnership, type OwnerShare } from "@/lib/ownership";

/** RLS filters rows silently: an update it refuses changes nothing and
 * reports no error, so a zero-row result is treated as refused. */
const NOT_CHANGED =
  "This unit could not be changed. It may be outside the properties assigned to you.";

export type ActionState = { error?: string; success?: string };

const blankOr = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([z.literal("").transform(() => undefined), schema]).optional();

const unitSchema = z.object({
  // An existing property, or "__new" to create one from the fields below.
  propertyId: z.union([z.string().uuid("Select a property"), z.literal("__new")], {
    message: "Select a property",
  }),
  newPropertyName: z.string().trim().max(120).optional(),
  newPropertyArea: z.string().trim().max(80).optional(),
  newPropertyKind: z
    .enum(["building", "villa_compound", "standalone_villa", "townhouse_cluster", "mixed_use"])
    .optional(),
  unitNumber: z.string().min(1, "Unit number is required").max(30),
  referenceCode: z.string().max(40).optional(),
  kind: z.enum([
    "apartment", "studio", "villa", "townhouse", "penthouse",
    "duplex", "loft", "office", "retail",
  ]),
  floor: z.string().max(10).optional(),
  bedrooms: z.coerce.number().min(0).max(20),
  bathrooms: z.coerce.number().min(0).max(20),
  sizeSqft: blankOr(z.coerce.number().min(0)),
  furnishing: z.enum(["unfurnished", "semi_furnished", "fully_furnished"]),
  parkingSpaces: z.coerce.number().int().min(0).max(20).default(0),
  viewDescription: z.string().max(120).optional(),
  dewaPremiseNumber: z.string().max(30).optional(),
  titleDeedNumber: z.string().max(40).optional(),
  makaniNumber: z.string().max(20).optional(),
  mollakUnitId: z.string().max(40).optional(),
  operatingMode: z.enum(["long_term", "short_term", "both", "not_operating"]),
  targetAnnualRent: blankOr(z.coerce.number().min(0)),
  baseNightlyRate: blankOr(z.coerce.number().min(0)),
  // Holiday home prices for direct bookings; an empty box means not set.
  weekendRate: blankOr(z.coerce.number().min(0)),
  cleaningFee: blankOr(z.coerce.number().min(0)),
  weeklyDiscount: blankOr(z.coerce.number().min(0).max(99, "A discount must be under 100%")),
  monthlyDiscount: blankOr(z.coerce.number().min(0).max(99, "A discount must be under 100%")),
  // Owners arrive as parallel ownerId / ownershipPct rows, read by
  // ownerSharesFrom: a unit may have several, sharing at most 100%.
  notes: z.string().max(1000).optional(),
});

/**
 * The unit's property: the one chosen, or - when "New building" was picked -
 * the one with that name (reused if it already exists), created with its
 * area on the spot so a unit and its building can be added in one go.
 */
async function resolveProperty(
  supabase: Awaited<ReturnType<typeof createClient>>,
  role: Parameters<typeof can>[0],
  input: z.infer<typeof unitSchema>
): Promise<{ id: string } | { error: string }> {
  if (input.propertyId !== "__new") return { id: input.propertyId };
  if (!can(role, "properties.manage")) return { error: "You do not have permission to add buildings." };
  const name = (input.newPropertyName ?? "").replace(/\s+/g, " ");
  if (name.length < 2) return { error: "Enter the new building's name." };

  const { data: existing } = await supabase
    .from("properties")
    .select("id, name")
    .eq("is_active", true);
  const match = (existing ?? []).find((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  if (match) return { id: match.id };

  let communityId: string | null = null;
  if (input.newPropertyArea) {
    const { data: community, error } = await supabase
      .from("communities")
      .upsert({ name: input.newPropertyArea, emirate: "dubai" }, { onConflict: "name,emirate" })
      .select("id")
      .single();
    if (error) return { error: `Could not save the area: ${error.message}` };
    communityId = community.id;
  }

  const { data, error } = await supabase
    .from("properties")
    .insert({ name, kind: input.newPropertyKind ?? "building", community_id: communityId })
    .select("id")
    .single();
  if (error) return { error: `Could not add the building: ${error.message}` };
  revalidatePath("/properties");
  return { id: data.id };
}

export async function createUnit(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) {
    return { error: "You do not have permission to add units." };
  }

  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const { shares, error: sharesError } = ownerSharesFrom(formData);
  if (sharesError) return { error: sharesError };

  const supabase = await createClient();
  const property = await resolveProperty(supabase, profile.role, input);
  if ("error" in property) return { error: property.error };

  const { data: unit, error } = await supabase
    .from("units")
    .insert({
      property_id: property.id,
      unit_number: input.unitNumber,
      reference_code: input.referenceCode || null,
      kind: input.kind,
      floor: input.floor || null,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      size_sqft: input.sizeSqft ?? null,
      furnishing: input.furnishing,
      parking_spaces: input.parkingSpaces,
      view_description: input.viewDescription || null,
      dewa_premise_number: input.dewaPremiseNumber || null,
      title_deed_number: input.titleDeedNumber || null,
      makani_number: input.makaniNumber || null,
      mollak_unit_id: input.mollakUnitId || null,
      operating_mode: input.operatingMode,
      target_annual_rent_aed: input.targetAnnualRent ?? null,
      base_nightly_rate_aed: input.baseNightlyRate ?? null,
      weekend_rate_aed: input.weekendRate ?? null,
      cleaning_fee_aed: input.cleaningFee ?? null,
      weekly_discount_pct: input.weeklyDiscount ?? null,
      monthly_discount_pct: input.monthlyDiscount ?? null,
      notes: input.notes || null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "That unit number already exists in this property." };
    }
    return { error: error.message };
  }

  if (shares.length) {
    const { error: ownershipError } = await supabase.from("unit_ownerships").insert(
      shares.map((share) => ({
        unit_id: unit.id,
        owner_id: share.ownerId,
        ownership_pct: share.pct,
        title_deed_number: input.titleDeedNumber || null,
      }))
    );

    if (ownershipError) {
      return {
        error: `Unit created, but the ownership record failed: ${ownershipError.message}`,
      };
    }
  }

  revalidatePath("/units");
  redirect(`/units/${unit.id}`);
}

export async function updateUnit(
  unitId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) {
    return { error: "You do not have permission to edit units." };
  }
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Unit not found." };

  const parsed = unitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const { shares, error: sharesError } = ownerSharesFrom(formData);
  if (sharesError) return { error: sharesError };
  const supabase = await createClient();
  const property = await resolveProperty(supabase, profile.role, input);
  if ("error" in property) return { error: property.error };

  // Fields for a pricing model the unit no longer uses are cleared, so a
  // stale nightly rate does not linger on a unit switched to long-term.
  const annual = input.operatingMode === "long_term" || input.operatingMode === "both";
  const nightly = input.operatingMode === "short_term" || input.operatingMode === "both";

  const { data: changed, error } = await supabase
    .from("units")
    .update({
      property_id: property.id,
      unit_number: input.unitNumber,
      reference_code: input.referenceCode || null,
      kind: input.kind,
      floor: input.floor || null,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      size_sqft: input.sizeSqft ?? null,
      furnishing: input.furnishing,
      parking_spaces: input.parkingSpaces,
      view_description: input.viewDescription || null,
      dewa_premise_number: input.dewaPremiseNumber || null,
      title_deed_number: input.titleDeedNumber || null,
      makani_number: input.makaniNumber || null,
      mollak_unit_id: input.mollakUnitId || null,
      operating_mode: input.operatingMode,
      target_annual_rent_aed: annual ? (input.targetAnnualRent ?? null) : null,
      base_nightly_rate_aed: nightly ? (input.baseNightlyRate ?? null) : null,
      weekend_rate_aed: nightly ? (input.weekendRate ?? null) : null,
      cleaning_fee_aed: nightly ? (input.cleaningFee ?? null) : null,
      weekly_discount_pct: nightly ? (input.weeklyDiscount ?? null) : null,
      monthly_discount_pct: nightly ? (input.monthlyDiscount ?? null) : null,
      notes: input.notes || null,
    })
    .eq("id", unitId)
    .select("id");

  if (error) {
    if (error.code === "23505") {
      return { error: "That unit number or reference already exists." };
    }
    return { error: error.message };
  }
  if (!changed?.length) return { error: NOT_CHANGED };

  // Forms without the owners editor (none today) leave ownership alone.
  if (formData.has("ownersEdited")) {
    const ownershipError = await syncOwnership(supabase, unitId, shares, input.titleDeedNumber);
    if (ownershipError) return { error: `Unit saved, but ownership was not: ${ownershipError}` };
  }

  revalidatePath("/units");
  revalidatePath(`/units/${unitId}`);
  redirect(`/units/${unitId}`);
}

/** The owners editor's rows: parallel ownerId / ownershipPct fields. */
function ownerSharesFrom(formData: FormData) {
  return parseOwnerShares(formData.getAll("ownerId").map(String), formData.getAll("ownershipPct").map(String));
}

/**
 * Brings a unit's active ownerships in line with the form. A removed owner's
 * record is closed today and kept as history (deleted if it was only set
 * today, i.e. a correction); changed shares are updated, smaller first, and
 * new owners start today. The database still refuses shares above 100%.
 */
async function syncOwnership(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  shares: OwnerShare[],
  titleDeedNumber: string | undefined
): Promise<string | null> {
  const { data: active, error } = await supabase
    .from("unit_ownerships")
    .select("id, owner_id, ownership_pct, start_date")
    .eq("unit_id", unitId)
    .is("end_date", null);
  if (error) return error.message;

  const today = dubaiToday();
  const plan = planOwnership(active ?? [], shares, today);

  for (const { id, delete: remove } of plan.end) {
    const { error: e } = remove
      ? await supabase.from("unit_ownerships").delete().eq("id", id)
      : await supabase.from("unit_ownerships").update({ end_date: today }).eq("id", id);
    if (e) return e.message;
  }
  for (const { id, pct } of plan.update) {
    const { error: e } = await supabase.from("unit_ownerships").update({ ownership_pct: pct }).eq("id", id);
    if (e) return e.message;
  }
  if (plan.add.length) {
    const { error: e } = await supabase.from("unit_ownerships").insert(
      plan.add.map((share) => ({
        unit_id: unitId,
        owner_id: share.ownerId,
        ownership_pct: share.pct,
        title_deed_number: titleDeedNumber || null,
        start_date: today,
      }))
    );
    if (e) return e.message;
  }
  return null;
}

const unitIdSchema = z.object({ unitId: z.string().uuid() });

/**
 * Takes a unit out of every list and report while keeping its tenancies,
 * bookings and ledger history. Reversible with restoreUnit.
 */
export async function archiveUnit(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) {
    return { error: "You do not have permission to archive units." };
  }
  const parsed = unitIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Unit not found." };
  const { unitId } = parsed.data;

  const supabase = await createClient();
  const { count: liveLeases } = await supabase
    .from("leases")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .in("status", ["active", "expiring", "pending_signature"]);
  if (liveLeases) {
    return { error: "This unit has a live tenancy. End or cancel it before archiving the unit." };
  }

  const { count: upcomingStays } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId)
    .gte("check_out", dubaiToday())
    .in("status", ["tentative", "confirmed", "checked_in"]);
  if (upcomingStays) {
    return { error: "This unit has upcoming bookings. Cancel or move them before archiving." };
  }

  const { data: changed, error } = await supabase
    .from("units")
    .update({ is_active: false })
    .eq("id", unitId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/units");
  revalidatePath(`/units/${unitId}`);
  return { success: "Unit archived. It no longer appears in lists or reports." };
}

export async function restoreUnit(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage")) {
    return { error: "You do not have permission to restore units." };
  }
  const parsed = unitIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Unit not found." };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("units")
    .update({ is_active: true })
    .eq("id", parsed.data.unitId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/units");
  revalidatePath(`/units/${parsed.data.unitId}`);
  return { success: "Unit restored." };
}

/**
 * Permanently removes a unit that was added by mistake. Anything with a
 * history - tenancies, bookings, money, maintenance, documents - must be
 * archived instead, so records the business or a regulator may need are never
 * destroyed. Super admin only: they see every row, so the history check is
 * complete.
 */
export async function deleteUnit(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") {
    return { error: "Only a super admin can delete a unit permanently." };
  }
  const parsed = unitIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Unit not found." };
  const { unitId } = parsed.data;

  const supabase = await createClient();
  const history = ["leases", "bookings", "ledger_entries", "maintenance_requests", "documents"] as const;
  const counts = await Promise.all(
    history.map((table) =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("unit_id", unitId)
    )
  );
  const failed = counts.find((c) => c.error);
  if (failed?.error) return { error: failed.error.message };
  if (counts.some((c) => (c.count ?? 0) > 0)) {
    return {
      error:
        "This unit has tenancies, bookings, transactions, maintenance or documents on file, " +
        "so it cannot be deleted. Archive it instead.",
    };
  }

  const { data: changed, error } = await supabase
    .from("units")
    .delete()
    .eq("id", unitId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/units");
  redirect("/units");
}


export async function createProperty(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "properties.manage")) {
    return { error: "You do not have permission to add properties." };
  }

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;

  const supabase = await createClient();
  let communityId = input.communityId ?? null;

  // Communities are reference data; letting a manager add one inline avoids a
  // dead end when a new area comes into the portfolio.
  if (!communityId && input.newCommunity) {
    const { data: community, error } = await supabase
      .from("communities")
      .upsert(
        { name: input.newCommunity, emirate: input.emirate },
        { onConflict: "name,emirate" }
      )
      .select("id")
      .single();

    if (error) return { error: `Could not create the community: ${error.message}` };
    communityId = community.id;
  }

  const { error } = await supabase
    .from("properties")
    .insert({
      community_id: communityId,
      name: input.name,
      kind: input.kind,
      developer_name: input.developerName || null,
      address_line: input.addressLine || null,
      makani_number: input.makaniNumber || null,
      floors: input.floors ?? null,
      total_units: input.totalUnits ?? null,
      owners_association_name: input.ownersAssociationName || null,
      mollak_property_id: input.mollakPropertyId || null,
    });

  if (error) return { error: error.message };

  revalidatePath("/properties");
  revalidatePath("/units");
  redirect(`/units?q=${encodeURIComponent(input.name)}`);
}
