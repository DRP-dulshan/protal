import { test } from "node:test";
import assert from "node:assert/strict";
import { amountIn, parseAirbnbReservationPage, parseDateText } from "@/lib/airbnb/reservation-page";

// The text of a reservation page as a browser copies it: each label and value
// on its own line.
const PAGE = `Reservations
Ahmed Al Mansoori
Confirmed
Marina Gate 1 · Luxury 1BR with Marina View
Oct 12 – 15, 2026 (3 nights)
Message Ahmed
Call Ahmed
Booking details
Guests
2 adults, 1 child
Check-in
Mon, Oct 12, 2026
Check-out
Thu, Oct 15, 2026
Booking date
Sun, Sep 20, 2026
Confirmation code
HMQ4K8XZ2P
Guest paid
AED 450.00 x 3 nights
AED 1,350.00
Cleaning fee
AED 150.00
Guest service fee
AED 211.80
Occupancy taxes
AED 45.00
Total (AED)
AED 1,756.80
Host payout
3-night room fee
AED 1,350.00
Cleaning fee
AED 150.00
Host service fee (3.0% + VAT)
-AED 47.25
You earn
AED 1,452.75`;

test("reads a reservation page", () => {
  const r = parseAirbnbReservationPage(PAGE, "https://www.airbnb.com/hosting/reservations/details/HMQ4K8XZ2P", "2026-10-01");
  assert.deepEqual(r, {
    code: "HMQ4K8XZ2P",
    guestName: "Ahmed",
    checkIn: "2026-10-12",
    checkOut: "2026-10-15",
    nights: 3,
    adults: 2,
    children: 1,
    infants: null,
    roomFee: 1350,
    cleaningFee: 150,
    hostServiceFee: 47.25,
    occupancyTaxes: 45,
    payout: 1452.75,
    currency: "AED",
  });
});

test("labels and amounts on one line, day-first dates, no year", () => {
  const r = parseAirbnbReservationPage(
    [
      "Guest name: Sara Lopez",
      "Check-in Sat, 3 Jan",
      "Check-out Tue, 6 Jan",
      "3 guests",
      "Host payout",
      "Room fee 1,200.00 AED",
      "Host service fee -36.00 AED",
      "Total (AED) 1,164.00 AED",
    ].join("\n"),
    null,
    "2026-10-01"
  );
  assert.equal(r.guestName, "Sara Lopez");
  assert.deepEqual([r.checkIn, r.checkOut, r.nights, r.adults], ["2027-01-03", "2027-01-06", 3, 3]);
  assert.deepEqual([r.roomFee, r.hostServiceFee, r.payout, r.cleaningFee], [1200, 36, 1164, null]);
});

test("a page with nothing recognisable gives empty fields, not errors", () => {
  const r = parseAirbnbReservationPage("Airbnb\nSomething went wrong", null, "2026-10-01");
  assert.deepEqual([r.code, r.checkIn, r.checkOut, r.payout, r.guestName], [null, null, null, null, null]);
});

test("amounts and dates", () => {
  assert.equal(amountIn("-AED 47.25"), 47.25);
  assert.equal(amountIn("3-night room fee AED 1,350.00"), 1350);
  assert.equal(parseDateText("Mon, Oct 12, 2026", "2026-10-01"), "2026-10-12");
  assert.equal(parseDateText("12 October 2026", "2026-10-01"), "2026-10-12");
  assert.equal(parseDateText("Decline 12", "2026-10-01"), null);
});
