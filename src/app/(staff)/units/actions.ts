"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";

export type ActionState = { error?: string; success?: string };

const optionalUuid = z
  .string()
  .uuid()
  .optional()
  .or(z.literal("").transform(() => undefined));

const unitSchema = z.object({
  propertyId: z.string().uuid("Select a property"),
  unitNumber: z.string().min(1, "Unit number is required").max(30),
  referenceCode: z.string().max(40).optional(),
  kind: z.enum([
    "apartment", "studio", "villa", "townhouse", "penthouse",
    "duplex", "loft", "office", "retail",
  ]),
  floor: z.string().max(10).optional(),
  bedrooms: z.coerce.number().min(0).max(20),
  bathrooms: z.coerce.number().min(0).max(20),
  sizeSqft: z.coerce.number().min(0).optional(),
  furnishing: z.enum(["unfurnished", "semi_furnished", "fully_furnished"]),
  parkingSpaces: z.coerce.number().int().min(0).max(20).default(0),
  viewDescription: z.string().max(120).optional(),
  dewaPremiseNumber: z.string().max(30).optional(),
  titleDeedNumber: z.string().max(40).optional(),
  makaniNumber: z.string().max(20).optional(),
  mollakUnitId: z.string().max(40).optional(),
  operatingMode: z.enum(["long_term", "short_term", "both", "not_operating"]),
  targetAnnualRent: z.coerce.number().min(0).optional(),
  baseNightlyRate: z.coerce.number().min(0).optional(),
  // Ownership is captured at the same time: a unit with no owner cannot be
  // billed, reported on, or shown in an owner portal.
  ownerId: optionalUuid,
  ownershipPct: z.coerce.number().min(0.01).max(100).default(100),
  notes: z.string().max(1000).optional(),
});

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

  const supabase = await createClient();

  const { data: unit, error } = await supabase
    .from("units")
    .insert({
      property_id: input.propertyId,
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

  if (input.ownerId) {
    const { error: ownershipError } = await supabase.from("unit_ownerships").insert({
      unit_id: unit.id,
      owner_id: input.ownerId,
      ownership_pct: input.ownershipPct,
      title_deed_number: input.titleDeedNumber || null,
    });

    if (ownershipError) {
      return {
        error: `Unit created, but the ownership record failed: ${ownershipError.message}`,
      };
    }
  }

  revalidatePath("/units");
  redirect(`/units/${unit.id}`);
}

const propertySchema = z.object({
  communityId: optionalUuid,
  newCommunity: z.string().max(80).optional(),
  emirate: z.enum([
    "dubai", "abu_dhabi", "sharjah", "ajman",
    "umm_al_quwain", "ras_al_khaimah", "fujairah",
  ]),
  name: z.string().min(2, "Property name is required").max(120),
  kind: z.enum([
    "building", "villa_compound", "standalone_villa",
    "townhouse_cluster", "mixed_use",
  ]),
  developerName: z.string().max(120).optional(),
  addressLine: z.string().max(200).optional(),
  makaniNumber: z.string().max(20).optional(),
  floors: z.coerce.number().int().min(0).max(200).optional(),
  totalUnits: z.coerce.number().int().min(0).optional(),
  ownersAssociationName: z.string().max(120).optional(),
  mollakPropertyId: z.string().max(40).optional(),
});

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
