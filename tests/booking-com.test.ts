import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bookingReservationAmounts,
  parseBookingDate,
  parseBookingReservations,
} from "@/lib/booking-com/reservations";
import { isBookingCalendarUrl } from "@/lib/ical/url";
import { toBookingEvents } from "@/lib/ical/parse";

// The shape of the extranet's export, as D|R|P downloads it.
const EXPORT = [
  "Property Name,Location,Booker Name,Genius Booker,Arrival,Departure,Booked on,Status,Total Payment,Commission,Currency,Reservation Number",
  '"FIVE Palm Jumeirah 3BR plus Luxury Lifestyle Residence","No. 1 Palm - The Palm Jumeirah - Dubai",Owen Rink,No,"July 12, 2026","July 15, 2026","November 7, 2025",Canceled,9180,0,AED,6666853821',
  '"St. Regis Sky Residence at Palm Tower by DRP Holiday Homes","1b Palm Jumeirah Rd",Nikolai Chernov,No,"January 18, 2026","February 5, 2026","December 27, 2025",OK,13646,2046.9,AED,6907398571',
  '"Chic Brand New Studio With Resort Facilities","Condor Golf Links 18",Djafar Harfouch,No,"October 29, 2026","December 1, 2026","August 10, 2026",OK,8280.36,1459.4095,AED,5600987303',
  ',,,,,,,,,,,',
].join("\n");

test("Booking.com dates: the extranet's 'July 12, 2026' and the usual alternatives", () => {
  assert.equal(parseBookingDate("July 12, 2026"), "2026-07-12");
  assert.equal(parseBookingDate("January 3, 2026"), "2026-01-03");
  assert.equal(parseBookingDate("12 Jul 2026"), "2026-07-12");
  assert.equal(parseBookingDate("2026-07-12"), "2026-07-12");
  assert.equal(parseBookingDate("12/07/2026"), "2026-07-12");
  assert.equal(parseBookingDate("February 30, 2026"), null);
  assert.equal(parseBookingDate(""), null);
});

test("reservations export: one stay per reservation number, cancellations marked", () => {
  const { reservations, skipped, errors } = parseBookingReservations(EXPORT);
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, [], "empty rows are dropped by the CSV reader");
  assert.equal(reservations.length, 3);

  const cancelled = reservations.find((r) => r.code === "6666853821")!;
  assert.equal(cancelled.cancelled, true);

  const stay = reservations.find((r) => r.code === "6907398571")!;
  assert.deepEqual(
    { ...stay },
    {
      code: "6907398571",
      property: "St. Regis Sky Residence at Palm Tower by DRP Holiday Homes",
      guest: "Nikolai Chernov",
      checkIn: "2026-01-18",
      checkOut: "2026-02-05",
      cancelled: false,
      total: 13646,
      commission: 2046.9,
      currency: "AED",
    }
  );
});

test("amounts: payout is the total less Booking.com's commission", () => {
  const r = parseBookingReservations(EXPORT).reservations.find((x) => x.code === "5600987303")!;
  const a = bookingReservationAmounts(r, 33);
  assert.equal(a.gross_total_aed, 8280.36);
  assert.equal(a.channel_commission_aed, 1459.41);
  assert.equal(a.payout_expected_aed, 6820.95);
  assert.equal(a.nightly_rate_aed, 250.92);
});

test("not a Booking.com export: a clear error", () => {
  const { errors } = parseBookingReservations("Date,Type,Amount\n1,2,3");
  assert.match(errors[0], /Reservation Number, Arrival and Departure/);
});

test("Booking.com calendar links and events", () => {
  assert.ok(isBookingCalendarUrl("https://admin.booking.com/hotel/hoteladmin/ical.html?t=abc"));
  assert.ok(!isBookingCalendarUrl("http://admin.booking.com/hotel/hoteladmin/ical.html?t=abc"), "https only");
  assert.ok(!isBookingCalendarUrl("https://booking.com.evil.example/ical"), "booking.com hosts only");
  assert.ok(!isBookingCalendarUrl("https://www.airbnb.com/calendar/ical/1.ics"));

  const events = toBookingEvents([
    { uid: "a@booking.com", start: "2026-07-12", end: "2026-07-15", summary: "CLOSED - Not available", description: "", status: null },
    { uid: "b@booking.com", start: "2026-08-01", end: "2026-08-03", summary: "CLOSED - Not available", description: "", status: "CANCELLED" },
  ]);
  assert.deepEqual(events, [{ uid: "a@booking.com", start: "2026-07-12", end: "2026-07-15", kind: "reservation", code: null }]);
});
