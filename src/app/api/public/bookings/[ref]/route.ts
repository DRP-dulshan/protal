import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";
import { parseDbError, STATUS_FOR_CODE, websiteAuthError } from "@/lib/website-api";

/**
 * PATCH /api/public/bookings/<ref> - move a website booking along:
 * { status: "confirmed" } once the guest has paid, { status: "cancelled" } if
 * they cancel or the checkout expires. Idempotent. Authenticated with WEBSITE_API_KEY.
 */
export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["confirmed", "cancelled"]),
  reason: z.string().max(300).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ ref: string }> }) {
  const denied = websiteAuthError(request);
  if (denied) return denied;

  const { ref } = await ctx.params;
  if (!/^[A-Z0-9-]{4,24}$/.test(ref)) return NextResponse.json({ error: "Unknown booking." }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid status." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("website_set_booking_status", {
    p_ref: ref,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? "",
  } as never);
  if (error) {
    const { code, message } = parseDbError(error.message);
    return NextResponse.json({ error: message, code }, { status: STATUS_FOR_CODE[code] ?? 500 });
  }
  return NextResponse.json({ ok: true, status: data });
}
