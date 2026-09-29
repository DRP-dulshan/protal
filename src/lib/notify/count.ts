import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";

/**
 * Unread notifications for the signed-in user (RLS scopes the count). Zero
 * without configuration, so a layout can ask before the auth check has
 * decided where to send the request.
 */
export async function unreadNotificationCount(): Promise<number> {
  if (!isConfigured) return 0;
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}
