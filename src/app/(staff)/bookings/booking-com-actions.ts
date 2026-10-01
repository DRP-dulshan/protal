"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { dubaiToday, nightsBetween } from "@/lib/calendar";
import {
  bookingReservationAmounts,
  parseBookingReservations,
  type BookingReservation,
} from "@/lib/booking-com/reservations";

export type BookingImportState = {
  error?: string;
  success?: string;
  /** Stays already in the portal that got their number, guest and price. */
  updated?: number;
  /** Stays added from the file, and how many of them have not ended. */
  created?: number;
  createdLive?: number;
  /** Stays cancelled here because Booking.com cancelled them. */
  cancelled?: number;
  /** Cancelled reservations that were never in the portal: nothing to do. */
  cancelledElsewhere?: number;
  overlapping?: string[];
  otherCurrency?: string[];
  failed?: string[];
  skipped?: string[];
  /** Properties in the file no unit is matched to yet. */
  unmatched?: { listing: string; stays: number }[];
  units?: { id: string; label: string }[];
  csvText?: string;
};

const MAX_CSV = 5_000_000;
const LIVE = ["tentative", "confirmed", "checked_in"] as const;

/**
 * Booking.com's reservations export -> bookings, much as Airbnb's earnings
 * file does for Airbnb:
 *
 *  - a stay already here with that reservation number gets its guest and
 *    price;
 *  - a stay from the Booking.com calendar feed (dates only, no number) on the
 *    matched unit with the same dates is adopted: it gets the number, guest
 *    and price;
 *  - a stay the portal has never seen is added - checked out if it has
 *    ended, confirmed otherwise - and announces nothing;
 *  - a reservation Booking.com cancelled is cancelled here if it was live.
 *
 * Units are matched by the file's Property Name, asked once per property and
 * kept on the unit (booking_listing_name). Safe to run again.
 */
export async function importBookingReservations(
  _prev: BookingImportState,
  formData: FormData
): Promise<BookingImportState> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) {
    return { error: "You do not have permission to import reservations." };
  }

  let text: string;
  const carried = formData.get("csvText");
  if (typeof carried === "string" && carried) {
    if (carried.length > MAX_CSV) return { error: "That file is too large for a reservations export." };
    text = carried;
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose the CSV file first." };
    if (file.size > MAX_CSV) return { error: "That file is too large for a reservations export." };
    if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/i.test(file.type)) {
      return {
        error:
          "Upload the export as CSV. If Booking.com gave you an Excel file, open it and save it as CSV (File → Save As / Export → CSV).",
      };
    }
    text = await file.text();
  }

  const { reservations, skipped, errors } = parseBookingReservations(text);
  if (errors.length) return { error: errors[0] };
  if (reservations.length === 0) return { error: "No reservations found in this file.", skipped };

  const supabase = await createClient();

  // Answers from the matching step: property name -> unit.
  const matchListings = formData.getAll("matchListing").map(String);
  const matchUnits = formData.getAll("matchUnit").map(String);
  for (let i = 0; i < matchListings.length; i++) {
    const listing = matchListings[i].trim();
    const unitId = matchUnits[i] ?? "";
    if (!listing || !z.string().uuid().safeParse(unitId).success) continue;
    const { error } = await supabase.from("units").update({ booking_listing_name: listing }).eq("id", unitId);
    if (error) return { error: `Could not save the match for "${listing}": ${error.message}` };
  }

  const [{ data: known, error: knownError }, { data: unitRows, error: unitsError }] = await Promise.all([
    supabase
      .from("bookings")
      .select("id, status, guest_id, check_in, check_out, external_booking_id")
      .eq("channel", "booking_com")
      .in("external_booking_id", reservations.map((r) => r.code)),
    supabase.from("units").select("id, unit_number, booking_listing_name, properties(name)").eq("is_active", true),
  ]);
  if (knownError) return { error: knownError.message };
  if (unitsError) return { error: unitsError.message };

  const byCode = new Map((known ?? []).map((b) => [b.external_booking_id!, b]));
  const unitByListing = new Map(
    (unitRows ?? [])
      .filter((u) => u.booking_listing_name)
      .map((u) => [u.booking_listing_name!.trim().toLowerCase(), u.id])
  );

  const today = dubaiToday();
  const state: Required<
    Pick<BookingImportState, "updated" | "created" | "createdLive" | "cancelled" | "cancelledElsewhere">
  > & { overlapping: string[]; otherCurrency: string[]; failed: string[] } = {
    updated: 0,
    created: 0,
    createdLive: 0,
    cancelled: 0,
    cancelledElsewhere: 0,
    overlapping: [],
    otherCurrency: [],
    failed: [],
  };
  const unmatchedCount = new Map<string, number>();

  async function guestFor(r: BookingReservation, existing: string | null): Promise<string | null> {
    if (existing || !r.guest) return existing;
    const { data } = await supabase.from("guests").insert({ full_name: r.guest }).select("id").single();
    return data?.id ?? null;
  }

  async function cancel(id: string) {
    const { error } = await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_on: today, cancellation_reason: "Cancelled on Booking.com" })
      .eq("id", id);
    if (error) throw new Error(error.message);
    state.cancelled++;
  }

  async function price(id: string, r: BookingReservation, guestId: string | null, extra: Record<string, unknown> = {}) {
    const { error } = await supabase
      .from("bookings")
      .update({
        guest_id: guestId,
        ...bookingReservationAmounts(r, nightsBetween(r.checkIn, r.checkOut)),
        ...extra,
      })
      .eq("id", id);
    if (error) throw new Error(error.message);
    state.updated++;
  }

  for (const r of reservations) {
    try {
      if (r.currency && r.currency !== "AED") {
        state.otherCurrency.push(`${r.code} (${r.currency})`);
        continue;
      }

      // 1. Already here under its reservation number.
      const known = byCode.get(r.code);
      if (known) {
        if (r.cancelled) {
          if ((LIVE as readonly string[]).includes(known.status)) await cancel(known.id);
        } else {
          await price(known.id, r, await guestFor(r, known.guest_id));
        }
        continue;
      }

      const unitId = r.property ? unitByListing.get(r.property.toLowerCase()) : undefined;
      if (!unitId) {
        if (r.property && !r.cancelled) unmatchedCount.set(r.property, (unmatchedCount.get(r.property) ?? 0) + 1);
        else if (r.cancelled) state.cancelledElsewhere++;
        continue;
      }

      // 2. From the Booking.com calendar feed: same unit, same dates, no number yet.
      const { data: fromFeed } = await supabase
        .from("bookings")
        .select("id, status, guest_id")
        .eq("unit_id", unitId)
        .eq("channel", "booking_com")
        .is("external_booking_id", null)
        .eq("check_in", r.checkIn)
        .eq("check_out", r.checkOut)
        .neq("status", "cancelled")
        .limit(1)
        .maybeSingle();
      if (fromFeed) {
        if (r.cancelled) {
          await supabase.from("bookings").update({ external_booking_id: r.code }).eq("id", fromFeed.id);
          if ((LIVE as readonly string[]).includes(fromFeed.status)) await cancel(fromFeed.id);
        } else {
          await price(fromFeed.id, r, await guestFor(r, fromFeed.guest_id), { external_booking_id: r.code });
        }
        continue;
      }

      if (r.cancelled) {
        state.cancelledElsewhere++;
        continue;
      }

      // 3. New to the portal - unless the unit already has a stay on those nights.
      const { data: clash } = await supabase
        .from("bookings")
        .select("id")
        .eq("unit_id", unitId)
        .not("status", "in", "(cancelled,no_show)")
        .lt("check_in", r.checkOut)
        .gt("check_out", r.checkIn)
        .limit(1);
      if (clash?.length) {
        state.overlapping.push(r.code);
        continue;
      }

      const ended = r.checkOut <= today;
      const { error } = await supabase.from("bookings").insert({
        booking_number: "", // set by the autonumber trigger
        unit_id: unitId,
        channel: "booking_com",
        status: ended ? "checked_out" : "confirmed",
        import_source: "earnings_csv",
        check_in: r.checkIn,
        check_out: r.checkOut,
        adults: 1,
        guest_count_known: false,
        external_booking_id: r.code,
        guest_id: await guestFor(r, null),
        internal_notes: "Added from Booking.com's reservations export.",
        ...bookingReservationAmounts(r, nightsBetween(r.checkIn, r.checkOut)),
      });
      if (error) {
        state.failed.push(`${r.code}: ${error.message}`);
      } else {
        state.created++;
        if (!ended) state.createdLive++;
      }
    } catch (error) {
      state.failed.push(`${r.code}: ${(error as Error).message}`);
    }
  }

  const unmatched = [...unmatchedCount]
    .map(([listing, stays]) => ({ listing, stays }))
    .sort((a, b) => a.listing.localeCompare(b.listing));
  const units = (unitRows ?? [])
    .map((u) => ({ id: u.id, label: `${u.properties?.name ?? ""} · ${u.unit_number}` }))
    .sort((a, b) => a.label.localeCompare(b.label));

  revalidatePath("/bookings");
  return {
    success: [
      `${state.updated} Booking.com ${state.updated === 1 ? "stay" : "stays"} updated.`,
      state.created
        ? `${state.created} ${state.created === 1 ? "stay" : "stays"} added (${state.created - state.createdLive} past, ${state.createdLive} current or upcoming).`
        : "",
      state.cancelled ? `${state.cancelled} cancelled.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    ...state,
    skipped,
    ...(unmatched.length ? { unmatched, units, csvText: text } : {}),
  };
}

/** Forgets a unit's Booking.com property match, so the next import asks again. */
export async function clearBookingListingMatch(unitId: string): Promise<{ error?: string; success?: string }> {
  const profile = await requireProfile();
  if (!can(profile.role, "bookings.manage")) return { error: "You do not have permission to do that." };
  if (!z.string().uuid().safeParse(unitId).success) return { error: "Unit not found." };
  const supabase = await createClient();
  const { error } = await supabase.from("units").update({ booking_listing_name: null }).eq("id", unitId);
  if (error) return { error: error.message };
  revalidatePath("/bookings/import/booking-com");
  return { success: "Match removed." };
}
