"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import type { ActionState } from "../units/actions";
import { propertySchema } from "./schema";

/** RLS filters rows silently: an update it refuses changes nothing and
 * reports no error, so a zero-row result is treated as refused. */
const NOT_CHANGED =
  "This property could not be changed. You may not have access to it.";

export async function updateProperty(
  propertyId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "properties.manage")) {
    return { error: "You do not have permission to edit properties." };
  }
  if (!z.string().uuid().safeParse(propertyId).success) return { error: "Property not found." };

  const parsed = propertySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  let communityId = input.communityId ?? null;
  if (!communityId && input.newCommunity) {
    const { data: community, error } = await supabase
      .from("communities")
      .upsert({ name: input.newCommunity, emirate: input.emirate }, { onConflict: "name,emirate" })
      .select("id")
      .single();
    if (error) return { error: `Could not create the community: ${error.message}` };
    communityId = community.id;
  }

  const { data: changed, error } = await supabase
    .from("properties")
    .update({
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
    })
    .eq("id", propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/properties");
  revalidatePath("/units");
  redirect("/properties");
}

const idSchema = z.object({ propertyId: z.string().uuid() });

export async function archiveProperty(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "properties.manage")) {
    return { error: "You do not have permission to archive properties." };
  }
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Property not found." };

  const supabase = await createClient();
  const { count } = await supabase
    .from("units")
    .select("id", { count: "exact", head: true })
    .eq("property_id", parsed.data.propertyId)
    .eq("is_active", true);
  if (count) {
    return {
      error: `This property still has ${count} active unit${count === 1 ? "" : "s"}. Archive or move them first.`,
    };
  }

  const { data: changed, error } = await supabase
    .from("properties")
    .update({ is_active: false })
    .eq("id", parsed.data.propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/properties");
  return { success: "Property archived." };
}

export async function restoreProperty(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "properties.manage")) {
    return { error: "You do not have permission to restore properties." };
  }
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Property not found." };

  const supabase = await createClient();
  const { data: changed, error } = await supabase
    .from("properties")
    .update({ is_active: true })
    .eq("id", parsed.data.propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/properties");
  return { success: "Property restored." };
}

/** Deletes a property added by mistake. Any unit, even archived, blocks it. */
export async function deleteProperty(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") {
    return { error: "Only a super admin can delete a property permanently." };
  }
  const parsed = idSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Property not found." };

  const supabase = await createClient();
  const { count, error: countError } = await supabase
    .from("units")
    .select("id", { count: "exact", head: true })
    .eq("property_id", parsed.data.propertyId);
  if (countError) return { error: countError.message };
  if (count) {
    return {
      error: "This property has units on file, so it cannot be deleted. Archive it instead.",
    };
  }

  const { data: changed, error } = await supabase
    .from("properties")
    .delete()
    .eq("id", parsed.data.propertyId)
    .select("id");
  if (error) return { error: error.message };
  if (!changed?.length) return { error: NOT_CHANGED };

  revalidatePath("/properties");
  redirect("/properties");
}
