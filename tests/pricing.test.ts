import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteStay, stayDiscountPct } from "@/lib/pricing";

// 2026-10-05 is a Monday.
const rates = { nightly: 340, weekend: 347, weeklyDiscountPct: 5, monthlyDiscountPct: 15 };

test("Friday and Saturday nights are charged at the weekend rate", () => {
  // Thu 8 Oct -> Sun 11 Oct: nights of Thu, Fri, Sat.
  const q = quoteStay("2026-10-08", "2026-10-11", rates);
  assert.deepEqual([q.nights, q.weekdayNights, q.weekendNights], [3, 1, 2]);
  assert.equal(q.nightsTotal, 340 + 347 * 2);
  assert.equal(q.discountPct, 0);
  assert.equal(q.accommodation, 1034);
});

test("no weekend rate means every night at the nightly rate", () => {
  const q = quoteStay("2026-10-08", "2026-10-11", { nightly: 340 });
  assert.equal(q.accommodation, 1020);
});

test("7 nights earn the weekly discount, 28 the monthly one, on the nights only", () => {
  const week = quoteStay("2026-10-05", "2026-10-12", rates);
  assert.equal(week.nights, 7);
  assert.equal(week.nightsTotal, 5 * 340 + 2 * 347);
  assert.equal(week.discountPct, 5);
  assert.equal(week.accommodation, Math.round((2394 - 119.7) * 100) / 100);

  const month = quoteStay("2026-10-05", "2026-11-02", rates);
  assert.equal(month.nights, 28);
  assert.equal(month.discountPct, 15);

  assert.equal(stayDiscountPct(6, rates), 0);
  assert.equal(stayDiscountPct(27, rates), 5);
  assert.equal(stayDiscountPct(30, { weeklyDiscountPct: 5 }), 5, "no monthly discount falls back to weekly");
});

test("a discount agreed by staff replaces the unit's", () => {
  assert.equal(quoteStay("2026-10-05", "2026-10-07", rates, 10).discount, 68);
  assert.equal(quoteStay("2026-10-05", "2026-10-12", rates, 0).discount, 0);
});
