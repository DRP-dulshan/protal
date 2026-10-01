/**
 * Only Airbnb's own hosts are fetched. The URL is typed in by staff, but the
 * server does the fetching, so an unrestricted URL would let anyone with that
 * form point our server at internal addresses.
 */
export function isAirbnbCalendarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443") &&
      /(^|\.)airbnb\.[a-z]{2,3}(\.[a-z]{2})?$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** Booking.com's calendar export (https://ical.booking.com/v1/export?t=…, or an older admin.booking.com link). */
export function isBookingCalendarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      (url.port === "" || url.port === "443") &&
      /(^|\.)booking\.com$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

/** The channels whose calendar feeds the portal reads. */
export type FeedChannel = "airbnb" | "booking_com";

export const FEED_CHANNEL_NAME: Record<FeedChannel, string> = {
  airbnb: "Airbnb",
  booking_com: "Booking.com",
};

export function isChannelCalendarUrl(channel: FeedChannel, value: string): boolean {
  return channel === "airbnb" ? isAirbnbCalendarUrl(value) : isBookingCalendarUrl(value);
}
