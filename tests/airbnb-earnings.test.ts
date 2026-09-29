import { test } from "node:test";
import assert from "node:assert/strict";
import {
  earningsToBookingAmounts,
  parseAirbnbEarnings,
  parseAmount,
  parseCsv,
} from "@/lib/airbnb/earnings-csv";

// The shape of Airbnb's Transaction history export: a payout row that repeats
// the money, reservation rows with quoted thousands, a long stay paid out in
// two parts, an adjustment, a BOM and CRLF line endings.
const EXPORT =
  "﻿" +
  [
    'Date,Arriving by date,Type,Confirmation code,Booking date,Start date,End date,Nights,Guest,Listing,Details,Reference code,Currency,Amount,Paid out,Service fee,Fast pay fee,Cleaning fee,Gross earnings,Occupancy taxes,Earnings year',
    '10/15/2026,10/16/2026,Payout,,,,,,,,"Transfer to ****1234, AED",,AED,,"3,512.00",,,,,,',
    '10/15/2026,,Reservation,HMABCDE123,09/01/2026,10/10/2026,10/15/2026,5,"Maria Lopez","Marina Gate 1 - 2807",,,AED,"3,512.00",,108.00,,250.00,"3,620.00",150.00,2026',
    '11/01/2026,,Reservation,HMLONG0001,09/20/2026,11/01/2026,12/15/2026,44,"John Smith","Opera Grand 505",,,AED,"10,000.00",,300.00,,0.00,"10,300.00",0.00,2026',
    '12/01/2026,,Reservation,HMLONG0001,09/20/2026,11/01/2026,12/15/2026,44,"John Smith","Opera Grand 505",,,AED,"8,500.00",,262.50,,0.00,"8,762.50",0.00,2026',
    '11/03/2026,,Adjustment,HMABCDE123,,,,,,,"Resolution",,AED,-50.00,,,,,,,2026',
  ].join("\r\n");

test("CSV parsing handles quotes, commas, doubled quotes and newlines in fields", () => {
  assert.deepEqual(parseCsv('a,"b, c","say ""hi""",\r\n"multi\nline",2,3,4\n'), [
    ["a", "b, c", 'say "hi"', ""],
    ["multi\nline", "2", "3", "4"],
  ]);
});

test("amounts: thousands separators, brackets and minus signs", () => {
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("(12.50)"), -12.5);
  assert.equal(parseAmount("-7"), -7);
  assert.equal(parseAmount(""), 0);
  assert.equal(parseAmount("AED 99.00"), 99);
});

test("only reservation rows count; a stay paid in parts is summed", () => {
  const { reservations, skipped, errors } = parseAirbnbEarnings(EXPORT);
  assert.deepEqual(errors, []);
  assert.deepEqual(skipped, { Payout: 1, Adjustment: 1 });
  assert.equal(reservations.length, 2);

  const maria = reservations.find((r) => r.code === "HMABCDE123")!;
  assert.equal(maria.guest, "Maria Lopez");
  assert.equal(maria.currency, "AED");
  assert.equal(maria.amount, 3512);
  assert.equal(maria.serviceFee, 108);
  assert.equal(maria.cleaningFee, 250);
  assert.equal(maria.grossEarnings, 3620);
  assert.equal(maria.occupancyTaxes, 150);

  const john = reservations.find((r) => r.code === "HMLONG0001")!;
  assert.equal(john.rows, 2);
  assert.equal(john.amount, 18500);
  assert.equal(john.serviceFee, 562.5);
  assert.equal(john.grossEarnings, 19062.5);
});

test("booking amounts: payout = guest total - commission - Tourism Dirham", () => {
  const { reservations } = parseAirbnbEarnings(EXPORT);
  const a = earningsToBookingAmounts(reservations.find((r) => r.code === "HMABCDE123")!, 5);
  assert.deepEqual(a, {
    accommodation_aed: 3370,
    nightly_rate_aed: 674,
    cleaning_fee_aed: 250,
    extra_fees_aed: 0,
    tourism_dirham_aed: 150,
    channel_commission_aed: 108,
    gross_total_aed: 3770,
    payout_expected_aed: 3512,
  });
  assert.equal(
    a.gross_total_aed - a.channel_commission_aed - a.tourism_dirham_aed,
    a.payout_expected_aed
  );
});

test("an export without a gross column derives it from payout plus fee", () => {
  const csv = "Type,Confirmation Code,Currency,Amount,Service Fee,Cleaning Fee\nReservation,HMOLD00001,AED,970.00,30.00,100.00\n";
  const [r] = parseAirbnbEarnings(csv).reservations;
  assert.equal(r.grossEarnings, 1000);
  assert.equal(earningsToBookingAmounts(r, 3).accommodation_aed, 900);
});

test("a file that is not the earnings export is refused with a hint", () => {
  const { reservations, errors } = parseAirbnbEarnings("Name,Email\nA,b@c.com\n");
  assert.equal(reservations.length, 0);
  assert.match(errors[0], /Transaction history/);
});
