import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { parseICal, toAirbnbEvents, toBookingEvents, ICalError } from "./parse";
import { FEED_CHANNEL_NAME, isAirbnbCalendarUrl, isChannelCalendarUrl, type FeedChannel } from "./url";

export { isAirbnbCalendarUrl };
export type { FeedChannel };

type Client = SupabaseClient<Database>;

export interface SyncResult {
  unitId: string;
  channel?: FeedChannel;
  ok: boolean;
  created?: number;
  updated?: number;
  reinstated?: number;
  cancelled?: number;
  blocks?: number;
  errors: string[];
}

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;

/** Downloads a feed, following redirects only while they stay on the channel's own site. */
export async function fetchCalendar(url: string, channel: FeedChannel = "airbnb"): Promise<string> {
  const site = FEED_CHANNEL_NAME[channel];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isChannelCalendarUrl(channel, current)) {
      throw new ICalError(
        channel === "airbnb"
          ? "The calendar link must be an https://www.airbnb… iCal export URL."
          : "The calendar link must be an https://admin.booking.com… iCal export URL."
      );
    }

    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { Accept: "text/calendar, text/plain;q=0.9", "User-Agent": "DRP-PMS calendar sync" },
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new ICalError(timedOut ? `${site} did not answer within 15 seconds.` : `Could not reach ${site}.`);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ICalError(`${site} redirected (HTTP ${response.status}) without a location.`);
      current = new URL(location, current).toString();
      continue;
    }
    if (response.status === 404 || response.status === 410) {
      throw new ICalError(`${site} says this calendar link does not exist. It may have been reset on ${site} - copy the export link again.`);
    }
    if (!response.ok) throw new ICalError(`${site} returned HTTP ${response.status}.`);

    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > MAX_BYTES) throw new ICalError("The calendar is unexpectedly large; not imported.");
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new ICalError("The calendar is unexpectedly large; not imported.");
    return text;
  }
  throw new ICalError(`Too many redirects from ${site}.`);
}

/**
 * Syncs one unit's feed on one channel: fetch and parse it, then reconcile it
 * in the database with a single apply_channel_ical() call - one round trip,
 * one transaction. Failures to fetch or parse are recorded on the unit (per
 * channel) so the admin screen shows them.
 *
 * Runs with whatever client it is given: the signed-in staff member's for
 * "Sync now" (RLS applies), the service client for the scheduled job.
 */
export async function syncUnit(
  client: Client,
  unitId: string,
  url: string,
  channel: FeedChannel = "airbnb"
): Promise<SyncResult> {
  let events;
  try {
    const parsed = parseICal(await fetchCalendar(url, channel));
    events = channel === "airbnb" ? toAirbnbEvents(parsed) : toBookingEvents(parsed);
  } catch (error) {
    const message = error instanceof ICalError ? error.message : "Unexpected error reading the calendar.";
    await client.rpc("apply_channel_ical", {
      p_unit_id: unitId,
      p_channel: channel,
      p_events: null,
      p_error: message,
    });
    return { unitId, channel, ok: false, errors: [message] };
  }

  const { data, error } = await client.rpc("apply_channel_ical", {
    p_unit_id: unitId,
    p_channel: channel,
    p_events: events,
  });
  if (error) return { unitId, channel, ok: false, errors: [error.message] };

  const result = data as unknown as Omit<SyncResult, "unitId">;
  return { unitId, channel, ...result, errors: result.errors ?? [] };
}

/** Every active unit's feeds (Airbnb and Booking.com), a few at a time. */
export async function syncAllUnits(
  client: Client,
  concurrency = 4,
  only?: FeedChannel
): Promise<SyncResult[]> {
  const { data: units, error } = await client
    .from("units")
    .select("id, airbnb_ical_url, booking_ical_url")
    .eq("is_active", true)
    .or("airbnb_ical_url.not.is.null,booking_ical_url.not.is.null");
  if (error) throw new Error(error.message);

  const queue: { id: string; url: string; channel: FeedChannel }[] = [];
  for (const u of units ?? []) {
    if (u.airbnb_ical_url && only !== "booking_com") queue.push({ id: u.id, url: u.airbnb_ical_url, channel: "airbnb" });
    if (u.booking_ical_url && only !== "airbnb") queue.push({ id: u.id, url: u.booking_ical_url, channel: "booking_com" });
  }
  const results: SyncResult[] = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        results.push(await syncUnit(client, job.id, job.url, job.channel));
      }
    })
  );
  return results;
}
