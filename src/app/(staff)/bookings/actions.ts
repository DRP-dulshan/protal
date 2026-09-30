"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dubaiToday, nightsBetween } from "@/lib/calendar";
import { quoteStay } from "@/lib/pricing";
import { flushEmailsSoon } from "@/lib/notify/flush";
import { earningsToBookingAmounts, parseAirbnbEarnings } from "@/lib/airbnb/earnings-csv";

export type ActionState = { error?: string; success?: string };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date");
const optionalDate = isoDate.optional().or(z.literal("").transform(() => undefined));
const money = z.coerce.number().min(0).max(10_000_000);

/**
 * Turns the database's guard rails into sentences. The permit gate and the
 * no-overlap constraint live in SQL (0005) so nothing can bypass them; this
 * only explains a refusal.
 */
function explain(error: { code?: string; message: string }): string {
  if (error.message.includes("no valid DET holiday home permit")) {
    return "This unit has no valid DET permit covering the check-in date. Add or renew the permit on the unit's DET permits tab first.";
  }
  if (error.code === "23P01" || error.message.includes("bookings_no_overlap")) {
    return "These dates overlap another booking for this unit.";
  }
  if (error.code === "42501" || error.message.includes("row-level security")) {
    return "You do not have access to this unit. Ask a super admin to assign it to you.";
  }
  if (error.code === "23505" && error.message.includes("hh_permits_number")) {
    return "That permit number is already recorded as active or pending.";
  }
  return error.message;
}

// ---------------------------------------------------------------------------
// DET permits
// ---------------------------------------------------------------------------

const permitSchema = z
  .object({
    permitNumber: z.string().trim().min(3, "Permit number is required").max(40),
    classification: z.string().max(40).optional(),
    operatorName: z.string().max(120).optional(),
    operatorLicenceNumber: z.string().max(40).optional(),
    issuedOn: isoDate,
    expiresOn: isoDate,
    nocReference: z.string().max(60).optional(),
    nocExpiresOn: optionalDate,
    notes: z.string().max(1000).optional(),
  })
  .refine((v) => v.expiresOn > v.issuedOn, {
    message: "The expiry date must be after the issue date.",
  });

export async function addPermit(
  unitId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "permits.manage")) {
    return { error: "You do not have permission to record DET permits." };
  }
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Unit not found." };

  const parsed = permitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  const { error } = await supabase.from("holiday_home_permits").insert({
    unit_id: unitId,
    permit_number: input.permitNumber,
    det_classification: input.classification || null,
    operator_name: input.operatorName || null,
    operator_licence_number: input.operatorLicenceNumber || null,
    issued_on: input.issuedOn,
    expires_on: input.expiresOn,
    status: input.expiresOn < dubaiToday() ? "expired" : "active",
    noc_reference: input.nocReference || null,
    noc_expires_on: input.nocExpiresOn ?? null,
    notes: input.notes || null,
    created_by: profile.id,
  });
  if (error) return { error: explain(error) };

  revalidatePath(`/units/${unitId}`);
  revalidatePath("/units");
  revalidatePath("/dashboard");
  revalidatePath("/compliance");
  return { success: `Permit ${input.permitNumber} recorded.` };
}

const PERMIT_STATUSES = ["draft", "pending", "active", "expired", "suspended", "cancelled"] as const;

/** Corrects a recorded permit: a typo in the number, new dates, a suspension. */
export async function updatePermit(
  permitId: string,
  unitId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "permits.manage")) {
    return { error: "You do not have permission to change DET permits." };
  }
  if (!z.string().uuid().safeParse(permitId).success || !z.string().uuid().safeParse(unitId).success) {
    return { error: "Permit not found." };
  }
  const parsed = permitSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const status = z.enum(PERMIT_STATUSES).safeParse(formData.get("status"));
  if (!status.success) return { error: "Choose the permit's status." };
  const input = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("holiday_home_permits")
    .update({
      permit_number: input.permitNumber,
      det_classification: input.classification || null,
      operator_name: input.operatorName || null,
      operator_licence_number: input.operatorLicenceNumber || null,
      issued_on: input.issuedOn,
      expires_on: input.expiresOn,
      // An active permit whose new expiry has passed is expired.
      status: status.data === "active" && input.expiresOn < dubaiToday() ? "expired" : status.data,
      noc_reference: input.nocReference || null,
      noc_expires_on: input.nocExpiresOn ?? null,
      notes: input.notes || null,
    })
    .eq("id", permitId)
    .eq("unit_id", unitId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: "This permit could not be changed. You may not have access to it." };

  revalidatePath(`/units/${unitId}`);
  revalidatePath("/units");
  revalidatePath("/dashboard");
  revalidatePath("/compliance");
  return { success: `Permit ${input.permitNumber} updated.` };
}

/** Removes a permit recorded by mistake. Bookings keep the number they were made under. */
export async function deletePermit(permitId: string, unitId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "permits.manage")) {
    return { error: "You do not have permission to change DET permits." };
  }
  if (!z.string().uuid().safeParse(permitId).success || !z.string().uuid().safeParse(unitId).success) {
    return { error: "Permit not found." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("holiday_home_permits")
    .delete()
    .eq("id", permitId)
    .eq("unit_id", unitId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!data?.length) return { error: "This permit could not be removed. You may not have access to it." };

  revalidatePath(`/units/${unitId}`);
  revalidatePath("/units");
  revalidatePath("/dashboard");
  revalidatePath("/compliance");
  return { success: "Permit removed." };
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

const CHANNELS = [
  "direct", "airbnb", "booking_com", "vrbo", "expedia", "agoda", "tripadvisor", "other",
] as const;

const bookingSchema = z
  .object({
    unitId: z.string().uuid("Select a unit"),
    channel: z.enum(CHANNELS),
    externalBookingId: z.string().max(60).optional(),
    status: z.enum(["inquiry", "tentative", "confirmed"]),
    checkIn: isoDate,
    checkOut: isoDate,
    adults: z.coerce.number().int().min(1, "At least one adult").max(30),
    children: z.coerce.number().int().min(0).max(30).default(0),
    infants: z.coerce.number().int().min(0).max(10).default(0),
    // The guest is either picked from the list or entered new.
    guestId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    guestName: z.string().max(160).optional(),
    guestEmail: z.string().email("Enter a valid guest email").or(z.literal("")).optional(),
    guestPhone: z.string().max(30).optional(),
    guestNationality: z.string().max(60).optional(),
    guestPassport: z.string().max(30).optional(),
    nightlyRate: money,
    // Friday and Saturday nights; blank or 0 means the nightly rate.
    weekendRate: money.default(0),
    discountPct: z.coerce.number().min(0).max(99, "A discount must be under 100%").default(0),
    cleaningFee: money.default(0),
    extraFees: money.default(0),
    tourismDirham: money.default(0),
    channelCommission: money.default(0),
    damageDeposit: money.default(0),
    guestMessage: z.string().max(2000).optional(),
    internalNotes: z.string().max(2000).optional(),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    message: "Check-out must be after check-in.",
    path: ["checkOut"],
  })
  .refine((v) => v.guestId || (v.guestName && v.guestName.trim().length >= 2), {
    message: "Choose a guest or enter the guest's name.",
    path: ["guestName"],
  });

/** Owner stays, maintenance and manual holds that fall inside these dates. */
async function blockingHolds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  unitId: string,
  start: string,
  end: string
) {
  const { data } = await supabase
    .from("availability_blocks")
    .select("id, reason, start_date, end_date, booking_id")
    .eq("unit_id", unitId)
    .lt("start_date", end)
    .gt("end_date", start)
    .neq("reason", "booking");
  return data ?? [];
}

export async function createBooking(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to add bookings." };
  }

  const parsed = bookingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  // Bookings only overlap-check against each other in SQL; an owner stay or a
  // maintenance hold is checked here.
  if (input.status !== "inquiry") {
    const holds = await blockingHolds(supabase, input.unitId, input.checkIn, input.checkOut);
    if (holds.length > 0) {
      const h = holds[0];
      return {
        error: `The unit is blocked from ${h.start_date} to ${h.end_date} (${h.reason.replace("_", " ")}). Remove the block or choose other dates.`,
      };
    }
  }

  let guestId = input.guestId ?? null;
  if (!guestId) {
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .insert({
        full_name: input.guestName!.trim(),
        email: input.guestEmail || null,
        phone: input.guestPhone || null,
        whatsapp: input.guestPhone || null,
        nationality: input.guestNationality || null,
        passport_number: input.guestPassport || null,
      })
      .select("id")
      .single();
    if (guestError) return { error: `Could not save the guest: ${guestError.message}` };
    guestId = guest.id;
  }

  // The same quote the form shows: weekend nights and the agreed discount.
  const { accommodation } = quoteStay(
    input.checkIn,
    input.checkOut,
    { nightly: input.nightlyRate, weekend: input.weekendRate },
    input.discountPct
  );
  const gross = round2(accommodation + input.cleaningFee + input.extraFees + input.tourismDirham);

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      booking_number: "",
      unit_id: input.unitId,
      guest_id: guestId,
      channel: input.channel,
      external_booking_id: input.externalBookingId || null,
      status: input.status,
      check_in: input.checkIn,
      check_out: input.checkOut,
      adults: input.adults,
      children: input.children,
      infants: input.infants,
      nightly_rate_aed: input.nightlyRate,
      accommodation_aed: accommodation,
      cleaning_fee_aed: input.cleaningFee,
      extra_fees_aed: input.extraFees,
      tourism_dirham_aed: input.tourismDirham,
      channel_commission_aed: input.channelCommission,
      gross_total_aed: gross,
      // Tourism Dirham is collected for the government, not paid out.
      payout_expected_aed: round2(gross - input.channelCommission - input.tourismDirham),
      damage_deposit_aed: input.damageDeposit,
      guest_message: input.guestMessage || null,
      internal_notes: input.internalNotes || null,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: explain(error) };

  flushEmailsSoon();
  revalidatePath("/bookings");
  revalidatePath(`/units/${input.unitId}`);
  redirect(`/bookings/${booking.id}`);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Which status each action moves a booking to, and from where. */
const TRANSITIONS = {
  confirm: { to: "confirmed", from: ["inquiry", "tentative"] },
  check_in: { to: "checked_in", from: ["confirmed"] },
  check_out: { to: "checked_out", from: ["checked_in"] },
  cancel: { to: "cancelled", from: ["inquiry", "tentative", "confirmed"] },
  no_show: { to: "no_show", from: ["confirmed"] },
} as const;

const statusSchema = z.object({
  bookingId: z.string().uuid(),
  transition: z.enum(["confirm", "check_in", "check_out", "cancel", "no_show"]),
  reason: z.string().max(300).optional(),
});

export async function changeBookingStatus(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to change bookings." };
  }
  const parsed = statusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Booking not found." };
  const { bookingId, transition, reason } = parsed.data;
  const step = TRANSITIONS[transition];

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, unit_id, check_in, check_out")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };
  if (!(step.from as readonly string[]).includes(booking.status)) {
    return { error: "This booking can no longer be changed that way. Reload the page." };
  }

  if (transition === "confirm") {
    const holds = await blockingHolds(supabase, booking.unit_id, booking.check_in, booking.check_out);
    if (holds.length > 0) {
      return { error: `The unit is blocked from ${holds[0].start_date} to ${holds[0].end_date}.` };
    }
  }

  const { data: changed, error } = await supabase
    .from("bookings")
    .update({
      status: step.to,
      ...(transition === "cancel"
        ? { cancelled_on: dubaiToday(), cancellation_reason: reason || null }
        : {}),
    })
    .eq("id", bookingId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!changed?.length) return { error: "This booking could not be changed." };

  flushEmailsSoon();
  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath(`/units/${booking.unit_id}`);
  const done = {
    confirm: "Booking confirmed.",
    check_in: "Guest checked in.",
    check_out: "Guest checked out. The turnover clean is scheduled.",
    cancel: "Booking cancelled. The dates are free again.",
    no_show: "Marked as no-show.",
  } as const;
  return { success: done[transition] };
}

// ---------------------------------------------------------------------------
// Calendar blocks
// ---------------------------------------------------------------------------

const blockSchema = z
  .object({
    unitId: z.string().uuid(),
    reason: z.enum(["owner_stay", "maintenance", "blocked"]),
    startDate: isoDate,
    endDate: isoDate,
    note: z.string().max(300).optional(),
  })
  .refine((v) => v.endDate > v.startDate, {
    message: "The end date must be after the start date.",
  });

export async function blockDates(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to block dates." };
  }
  const parsed = blockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  const { data: clash } = await supabase
    .from("bookings")
    .select("booking_number, check_in, check_out")
    .eq("unit_id", input.unitId)
    .in("status", ["tentative", "confirmed", "checked_in"])
    .lt("check_in", input.endDate)
    .gt("check_out", input.startDate)
    .limit(1);
  if (clash?.length) {
    const b = clash[0];
    return {
      error: `Booking ${b.booking_number} (${b.check_in} to ${b.check_out}) is in these dates. Cancel or move it first.`,
    };
  }

  const { error } = await supabase.from("availability_blocks").insert({
    unit_id: input.unitId,
    reason: input.reason,
    start_date: input.startDate,
    end_date: input.endDate,
    note: input.note || null,
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath(`/units/${input.unitId}`);
  return { success: "Dates blocked." };
}

/**
 * Deletes a booking outright - for one entered by mistake or imported from
 * the wrong Airbnb calendar. Super admins only, and never once money is
 * recorded against it (ledger, invoice or payment): such a stay is cancelled
 * instead, so the accounts keep their trail. Its calendar hold and
 * notifications go with it; unfinished cleaning tasks for it are removed.
 */
export async function deleteBooking(bookingId: string): Promise<ActionState> {
  const profile = await requireProfile();
  if (profile.role !== "super_admin") return { error: "Only a super admin can delete a booking." };
  if (!z.string().uuid().safeParse(bookingId).success) return { error: "Booking not found." };

  const supabase = await createClient();
  const { data: booking } = await supabase
    .from("bookings")
    .select("id, booking_number, unit_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };

  const money = await Promise.all(
    (["ledger_entries", "invoices", "payments"] as const).map((table) =>
      supabase.from(table).select("id", { count: "exact", head: true }).eq("booking_id", bookingId)
    )
  );
  const failed = money.find((m) => m.error);
  if (failed?.error) return { error: failed.error.message };
  if (money.some((m) => (m.count ?? 0) > 0)) {
    return {
      error: "Money is recorded against this booking (ledger, invoice or payment), so it cannot be deleted. Cancel it instead.",
    };
  }

  await supabase
    .from("housekeeping_tasks")
    .delete()
    .eq("booking_id", bookingId)
    .in("status", ["pending", "assigned"]);

  const { data: removed, error } = await supabase.from("bookings").delete().eq("id", bookingId).select("id");
  if (error) return { error: explain(error) };
  if (!removed?.length) return { error: "This booking could not be deleted. You may not have access to its unit." };

  revalidatePath("/bookings");
  revalidatePath(`/units/${booking.unit_id}`);
  revalidatePath("/dashboard");
  redirect("/bookings");
}

const removeBlockSchema = z.object({ blockId: z.string().uuid(), unitId: z.string().uuid() });

export async function removeBlock(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to change the calendar." };
  }
  const parsed = removeBlockSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Block not found." };

  const supabase = await createClient();
  // Booking blocks follow their booking; only manual holds are removed here.
  const { data: removed, error } = await supabase
    .from("availability_blocks")
    .delete()
    .eq("id", parsed.data.blockId)
    .neq("reason", "booking")
    .select("id");
  if (error) return { error: error.message };
  if (!removed?.length) return { error: "This block could not be removed." };

  revalidatePath(`/units/${parsed.data.unitId}`);
  return { success: "Block removed. The dates are free again." };
}

// ---------------------------------------------------------------------------
// Prices: Airbnb stays arrive from the calendar feed with dates only.
// ---------------------------------------------------------------------------

const priceSchema = z.object({
  accommodation: money,
  cleaningFee: money.default(0),
  extraFees: money.default(0),
  tourismDirham: money.default(0),
  channelCommission: money.default(0),
  guestName: z.string().trim().max(160).optional(),
});

const payoutOnlySchema = z.object({
  payout: money.refine((n) => n > 0, "Enter the payout shown on the Airbnb reservation."),
  guestName: z.string().trim().max(160).optional(),
});

/**
 * Enters or corrects a booking's price. The payout is derived from the
 * breakdown, except in "Airbnb total only" mode where it is all there is.
 */
export async function updateBookingPrice(
  bookingId: string,
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to change booking prices." };
  }
  if (!z.string().uuid().safeParse(bookingId).success) return { error: "Booking not found." };

  // "Airbnb total only": the reservation panel shows just the payout. The
  // breakdown stays empty until the earnings CSV fills it in.
  const payoutOnly = formData.get("mode") === "payout";
  const parsed = payoutOnly
    ? payoutOnlySchema.safeParse(Object.fromEntries(formData))
    : priceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Check the amounts and try again." };
  }
  const input = parsed.data;
  const supabase = await createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, unit_id, check_in, check_out, guest_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) return { error: "Booking not found." };

  let guestId = booking.guest_id;
  if (!guestId && input.guestName && input.guestName.length >= 2) {
    const { data: guest, error: guestError } = await supabase
      .from("guests")
      .insert({ full_name: input.guestName })
      .select("id")
      .single();
    if (guestError) return { error: `Could not save the guest: ${guestError.message}` };
    guestId = guest.id;
  }

  let amounts;
  if ("payout" in input) {
    amounts = { payout_expected_aed: round2(input.payout) };
  } else {
    const nights = nightsBetween(booking.check_in, booking.check_out);
    const gross = round2(input.accommodation + input.cleaningFee + input.extraFees + input.tourismDirham);
    amounts = {
      accommodation_aed: input.accommodation,
      nightly_rate_aed: nights > 0 ? round2(input.accommodation / nights) : null,
      cleaning_fee_aed: input.cleaningFee,
      extra_fees_aed: input.extraFees,
      tourism_dirham_aed: input.tourismDirham,
      channel_commission_aed: input.channelCommission,
      gross_total_aed: gross,
      payout_expected_aed: round2(gross - input.channelCommission - input.tourismDirham),
    };
  }
  const { data: changed, error } = await supabase
    .from("bookings")
    .update({ guest_id: guestId, ...amounts })
    .eq("id", bookingId)
    .select("id");
  if (error) return { error: explain(error) };
  if (!changed?.length) return { error: "This booking could not be changed." };

  revalidatePath("/bookings");
  revalidatePath(`/bookings/${bookingId}`);
  return { success: "Price saved." };
}

export type ImportState = ActionState & {
  updated?: number;
  notFound?: string[];
  otherCurrency?: string[];
  skipped?: Record<string, number>;
  /** Airbnb stays still without a price whose code was not in the file. */
  stillMissing?: { id: string; code: string; unit: string; checkIn: string }[];
  stillMissingTotal?: number;
};

/**
 * Airbnb's earnings export -> booking prices, matched on the confirmation
 * code the calendar sync stores in external_booking_id. Re-importing the same
 * file sets the same values again, so it is safe to repeat.
 */
export async function importAirbnbEarnings(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to import earnings." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file first." };
  if (file.size > 5_000_000) return { error: "That file is too large for an earnings export." };

  const { reservations, skipped, errors } = parseAirbnbEarnings(await file.text());
  if (errors.length) return { error: errors[0] };
  if (reservations.length === 0) {
    return { error: "No reservations found in this file.", skipped };
  }

  const supabase = await createClient();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, external_booking_id, check_in, check_out, guest_id")
    .eq("channel", "airbnb")
    .in("external_booking_id", reservations.map((r) => r.code));
  if (error) return { error: error.message };

  const byCode = new Map((bookings ?? []).map((b) => [b.external_booking_id!.toUpperCase(), b]));
  const notFound: string[] = [];
  const otherCurrency: string[] = [];
  let updated = 0;

  for (const r of reservations) {
    const booking = byCode.get(r.code);
    if (!booking) {
      notFound.push(r.code);
      continue;
    }
    // Amounts are kept in AED; a payout in another currency needs a rate.
    if (r.currency && r.currency !== "AED") {
      otherCurrency.push(`${r.code} (${r.currency})`);
      continue;
    }

    let guestId = booking.guest_id;
    if (!guestId && r.guest) {
      const { data: guest } = await supabase
        .from("guests")
        .insert({ full_name: r.guest })
        .select("id")
        .single();
      guestId = guest?.id ?? null;
    }

    const { data: changed } = await supabase
      .from("bookings")
      .update({
        guest_id: guestId,
        ...earningsToBookingAmounts(r, nightsBetween(booking.check_in, booking.check_out)),
      })
      .eq("id", booking.id)
      .select("id");
    if (changed?.length) updated++;
  }

  // Stays the file did not cover: usually the other Airbnb tab (Paid or
  // Upcoming) or a date range that ends too early.
  const inFile = new Set(reservations.map((r) => r.code));
  const { data: unpriced } = await supabase
    .from("bookings")
    .select("id, external_booking_id, check_in, units(unit_number, properties(name))")
    .eq("channel", "airbnb")
    .in("status", ["tentative", "confirmed", "checked_in", "checked_out"])
    .eq("gross_total_aed", 0)
    .or("payout_expected_aed.is.null,payout_expected_aed.eq.0")
    .order("check_in");
  const missing = (unpriced ?? []).filter(
    (b) => !b.external_booking_id || !inFile.has(b.external_booking_id.toUpperCase())
  );

  revalidatePath("/bookings");
  return {
    success: `${updated} Airbnb ${updated === 1 ? "booking" : "bookings"} priced.`,
    updated,
    notFound,
    otherCurrency,
    skipped,
    stillMissing: missing.slice(0, 30).map((b) => ({
      id: b.id,
      code: b.external_booking_id ?? "no code",
      unit: `${b.units?.properties?.name ?? ""} ${b.units?.unit_number ?? ""}`.trim(),
      checkIn: b.check_in,
    })),
    stillMissingTotal: missing.length,
  };
}
