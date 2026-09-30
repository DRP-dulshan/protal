import { test } from "node:test";
import assert from "node:assert/strict";
import { parseOwnerShares, planOwnership } from "@/lib/ownership";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

test("owner rows: blanks ignored, shares checked, total at most 100%", () => {
  assert.deepEqual(parseOwnerShares([A, "", B], ["60", "", "40"]), {
    shares: [{ ownerId: A, pct: 60 }, { ownerId: B, pct: 40 }],
  });
  assert.deepEqual(parseOwnerShares([A], [""]).shares, [{ ownerId: A, pct: 100 }], "a lone owner defaults to 100%");
  assert.deepEqual(parseOwnerShares([], []).shares, [], "no owner at all is allowed");
  assert.match(parseOwnerShares([A, B], ["60", "50"]).error!, /add up to 110%/);
  assert.match(parseOwnerShares([A, A], ["50", "50"]).error!, /listed twice/);
  assert.match(parseOwnerShares([A], ["0"]).error!, /more than 0%/);
  assert.match(parseOwnerShares(["nope"], ["100"]).error!, /Choose the owner/);
});

test("adding a co-owner shrinks the first owner's share before adding the second", () => {
  const plan = planOwnership(
    [{ id: "o1", owner_id: A, ownership_pct: 100, start_date: "2026-01-01" }],
    [{ ownerId: A, pct: 50 }, { ownerId: B, pct: 50 }],
    "2026-09-30"
  );
  assert.deepEqual(plan, { end: [], update: [{ id: "o1", pct: 50 }], add: [{ ownerId: B, pct: 50 }] });
});

test("a removed owner is ended (history) unless they were added today", () => {
  const plan = planOwnership(
    [
      { id: "o1", owner_id: A, ownership_pct: 50, start_date: "2026-01-01" },
      { id: "o2", owner_id: B, ownership_pct: 30, start_date: "2026-09-30" },
      { id: "o3", owner_id: C, ownership_pct: 20, start_date: "2026-01-01" },
    ],
    [{ ownerId: C, pct: 100 }],
    "2026-09-30"
  );
  assert.deepEqual(plan.end, [{ id: "o1", delete: false }, { id: "o2", delete: true }]);
  assert.deepEqual(plan.update, [{ id: "o3", pct: 100 }]);
  assert.deepEqual(plan.add, []);
});

test("share changes run smallest first so the total never passes 100%", () => {
  const plan = planOwnership(
    [
      { id: "o1", owner_id: A, ownership_pct: 70, start_date: "2026-01-01" },
      { id: "o2", owner_id: B, ownership_pct: 30, start_date: "2026-01-01" },
    ],
    [{ ownerId: A, pct: 40 }, { ownerId: B, pct: 60 }],
    "2026-09-30"
  );
  assert.deepEqual(plan.update, [{ id: "o1", pct: 40 }, { id: "o2", pct: 60 }]);
});
