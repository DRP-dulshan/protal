"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth/session";

/**
 * Marks the signed-in user's notifications read. RLS limits the update to
 * their own rows and the column grant to read_at. Revalidating the layout
 * refreshes the unread count in the sidebar, which layouts otherwise keep.
 */
export async function markNotificationsRead(): Promise<void> {
  const profile = await getProfile();
  if (!profile) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .is("read_at", null);

  revalidatePath("/", "layout");
}
