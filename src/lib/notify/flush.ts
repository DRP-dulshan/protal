import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { sendQueuedEmails } from "./email";

/**
 * Sends queued booking emails once the current response has gone out, so the
 * person who saved a booking does not wait on the mail provider. Anything
 * this misses is picked up by the next scheduled sync.
 */
export function flushEmailsSoon(): void {
  if (!env.supabaseServiceRoleKey) return;
  after(async () => {
    try {
      await sendQueuedEmails(createAdminClient());
    } catch (error) {
      console.error("[notify] sending queued emails failed:", error);
    }
  });
}
