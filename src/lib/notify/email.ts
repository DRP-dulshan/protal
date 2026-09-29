import type { createAdminClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { sendMessage } from "@/lib/messaging";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Sends the emails the booking trigger (0018) queued in `messages`.
 *
 * Runs with the service key: it is system work, triggered by the scheduler
 * after each Airbnb sync and after staff change a booking, never on behalf of
 * a user's request. Each row is claimed before it is sent, so two runs at
 * once cannot email the same person twice.
 *
 * Without an email provider configured the queued rows are marked failed
 * rather than left waiting: switching email on later must not deliver a
 * backlog of stale booking news.
 */
export async function sendQueuedEmails(
  client: AdminClient,
  limit = 50
): Promise<{ sent: number; failed: number }> {
  const { data: queued } = await client
    .from("messages")
    .select("id, to_address, subject, body, variables")
    .eq("channel", "email")
    .eq("status", "queued")
    .is("provider", null)
    .order("queued_at")
    .limit(limit);

  let sent = 0;
  let failed = 0;

  for (const row of queued ?? []) {
    const { data: claimed } = await client
      .from("messages")
      .update({ provider: "sending" })
      .eq("id", row.id)
      .eq("status", "queued")
      .is("provider", null)
      .select("id");
    if (!claimed?.length) continue;

    const vars = (row.variables ?? {}) as { portal?: string; link?: string };
    const base = vars.portal === "owner" ? env.ownerUrl : env.adminUrl;
    const body =
      row.body +
      (vars.link ? `\n\nOpen in the portal: ${base}${vars.link}` : "") +
      `\n\n${env.appName}`;

    const result = await sendMessage({
      channel: "email",
      to: row.to_address,
      subject: row.subject ?? env.appName,
      body,
    });

    const delivered = result.ok && !result.skipped;
    await client
      .from("messages")
      .update(
        delivered
          ? {
              status: "sent",
              sent_at: new Date().toISOString(),
              provider: result.provider,
              provider_message_id: result.providerMessageId ?? null,
            }
          : {
              status: "failed",
              provider: result.provider,
              error_message: result.skipped
                ? "Email is not set up (EMAIL_PROVIDER / RESEND_API_KEY)."
                : (result.error ?? "Unknown error"),
            }
      )
      .eq("id", row.id);

    if (delivered) sent++;
    else failed++;
  }

  return { sent, failed };
}
