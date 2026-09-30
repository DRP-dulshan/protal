"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/rbac";

export type NoteState = { error?: string; ok?: number };

const noteSchema = z.object({
  note: z.string().trim().min(1, "Write a note first.").max(2000),
  internal: z.literal("on").optional(),
});

/**
 * A note on a repair or complaint, from staff or the unit's owner. Only staff
 * may mark a note internal; the database refuses it from anyone else and
 * hides internal notes from owners.
 */
export async function addTicketNote(
  ticketId: string,
  _prev: NoteState,
  formData: FormData
): Promise<NoteState> {
  const profile = await requireProfile();
  if (!z.string().uuid().safeParse(ticketId).success) return { error: "Unknown ticket." };
  const parsed = noteSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the note." };

  const supabase = await createClient();
  const { error } = await supabase.from("maintenance_updates").insert({
    request_id: ticketId,
    author_id: profile.id,
    note: parsed.data.note,
    is_internal: isStaff(profile.role) && parsed.data.internal === "on",
  });
  if (error) {
    return {
      error: error.code === "42501" ? "You cannot add notes to this ticket." : error.message,
    };
  }

  revalidatePath(`/maintenance/${ticketId}`);
  revalidatePath(`/portal/owner/maintenance/${ticketId}`);
  return { ok: Date.now() };
}
