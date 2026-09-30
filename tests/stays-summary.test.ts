import { test } from "node:test";
import assert from "node:assert/strict";
import { summariseStays } from "@/lib/stays-summary";

const stay = (check_in: string, check_out: string, payout: number | null, gross = 0) => ({
  check_in,
  check_out,
  payout_expected_aed: payout,
  gross_total_aed: gross,
});

test("nights and payout inside the window, stays across the edge pro rata", () => {
  const s = summariseStays(
    [
      stay("2026-09-10", "2026-09-15", 1000), // 5 nights, all inside
      stay("2026-08-27", "2026-09-06", 1000), // 10 nights, 5 inside (1-5 Sep)
      stay("2026-09-29", "2026-10-03", 400), // 4 nights, 2 inside (29-30 Sep)
      stay("2026-10-05", "2026-10-08", 999), // outside
    ],
    "2026-09-01",
    "2026-09-30"
  );
  assert.deepEqual(s, { nights: 12, payout: 1000 + 500 + 200, unpriced: 0 });
});

test("guest total is used when there is no payout; unpriced stays are counted", () => {
  const s = summariseStays(
    [stay("2026-09-10", "2026-09-12", null, 600), stay("2026-09-20", "2026-09-22", null, 0)],
    "2026-09-01",
    "2026-09-30"
  );
  assert.deepEqual(s, { nights: 4, payout: 600, unpriced: 1 });
});
