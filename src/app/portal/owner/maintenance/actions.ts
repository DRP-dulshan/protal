"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth/session";

export type ActionState = { error?: string; success?: string };

const schema = z.object({
  ticketId: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  approvedAmount: z.coerce.number().min(0).optional(),
  reason: z.string().max(500).optional(),
});

/**
 * Owner decision on a maintenance quote.
 *
 * The database refuses to move a ticket past 'approved' while the approval
 * timestamp is null, so this is the only route by which above-threshold work
 * can begin - the UI cannot bypass it and neither can staff.
 */
export async function decideMaintenance(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireRole(["owner"]);

  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Invalid request." };
  const { ticketId, decision, approvedAmount, reason } = parsed.data;

  const supabase = await createClient();
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("maintenance_requests")
    .update(
      decision === "approve"
        ? {
            owner_approved_at: now,
            owner_approved_by: profile.id,
            approved_amount_aed: approvedAmount ?? null,
            status: "approved",
          }
        : {
            owner_rejected_at: now,
            owner_rejection_reason: reason ?? null,
            status: "rejected",
          }
    )
    .eq("id", ticketId);

  if (error) return { error: error.message };

  revalidatePath("/portal/owner/maintenance");
  revalidatePath("/portal/owner");
  return {
    success:
      decision === "approve"
        ? "Approved. Your property manager has been notified and work can begin."
        : "Declined. Your property manager has been notified.",
  };
}
