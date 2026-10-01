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
