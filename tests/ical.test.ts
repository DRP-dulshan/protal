import { test } from "node:test";
import assert from "node:assert/strict";
import { parseICal, toAirbnbEvents, ICalError } from "@/lib/ical/parse";
import { buildICal } from "@/lib/ical/build";

// The shape of a real Airbnb listing export: CRLF line endings, folded lines,
// reservations as "Reserved" with a reservation URL, host blocks as
// "Airbnb (Not available)".
const AIRBNB_FEED = [
  "BEGIN:VCALENDAR",
  "PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 1.0//EN",
  "CALSCALE:GREGORIAN",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261015",
  "DTSTART;VALUE=DATE:20261010",
  "UID:1418fb94e984-0e1d0b1c6b1f34d2d7b1a0e4f6c9f0b2@airbnb.com",
  "DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCDE123\\nPhone ",
  " Number (Last 4 Digits): 4471",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261103",
  "DTSTART;VALUE=DATE:20261101",
  "UID:7f3c2a1e9b0d-5a4e6f8c2d1b3e5f7a9c0e2d4b6f8a1c3e@airbnb.com",
  "SUMMARY:Airbnb (Not available)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTEND;VALUE=DATE:20261203",
  "DTSTART;VALUE=DATE:20261201",
  "UID:cancelled-one@airbnb.com",
  "STATUS:CANCELLED",
  "SUMMARY:Reserved",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

test("parses an Airbnb feed, including folded lines", () => {
  const events = parseICal(AIRBNB_FEED);
  assert.equal(events.length, 3);
  assert.equal(events[0].start, "2026-10-10");
  assert.equal(events[0].end, "2026-10-15");
  assert.match(events[0].description, /Phone Number \(Last 4 Digits\)/);
});

test("classifies reservations and blocks, extracts the code, drops cancellations", () => {
  const feed = toAirbnbEvents(parseICal(AIRBNB_FEED));
  assert.deepEqual(feed, [
    {
      uid: "1418fb94e984-0e1d0b1c6b1f34d2d7b1a0e4f6c9f0b2@airbnb.com",
      start: "2026-10-10",
      end: "2026-10-15",
      kind: "reservation",
      code: "HMABCDE123",
    },
    {
      uid: "7f3c2a1e9b0d-5a4e6f8c2d1b3e5f7a9c0e2d4b6f8a1c3e@airbnb.com",
      start: "2026-11-01",
      end: "2026-11-03",
      kind: "blocked",
      code: null,
    },
  ]);
});

test("the guest's phone digits are never carried into the feed events", () => {
  const feed = toAirbnbEvents(parseICal(AIRBNB_FEED));
  assert.ok(!JSON.stringify(feed).includes("4471"));
});

test("rejects things that are not calendars", () => {
  assert.throws(() => parseICal("<html>Sign in to Airbnb</html>"), ICalError);
});

test("handles LF endings, timed values and a missing DTEND", () => {
  const text = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:a",
    "DTSTART:20261231T210000Z", // 1 Jan 01:00 in Dubai
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:no-dates",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\n");
  const [only, ...rest] = parseICal(text);
  assert.equal(rest.length, 0);
  assert.equal(only.start, "2027-01-01");
  assert.equal(only.end, "2027-01-02");
});

test("export feed: CRLF, all-day events, no personal data, round-trips", () => {
  const ics = buildICal({
    name: "Marina Gate 1 2807",
    now: new Date("2026-09-29T08:00:00Z"),
    events: [
      { uid: "booking-1", start: "2026-10-01", end: "2026-10-04", kind: "booking" },
      { uid: "block-2", start: "2026-10-10", end: "2026-10-12", kind: "owner_stay" },
    ],
  });
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n"));
  assert.ok(ics.endsWith("END:VCALENDAR\r\n"));
  assert.ok(ics.includes("DTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261004"));
  assert.ok(ics.includes("SUMMARY:Blocked"));
  assert.ok(!/owner_stay/.test(ics), "block reasons stay internal");
  assert.ok(ics.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75));

  const back = parseICal(ics);
  assert.deepEqual(
    back.map((e) => [e.uid, e.start, e.end, e.summary]),
    [
      ["booking-1@drp-pms", "2026-10-01", "2026-10-04", "Reserved"],
      ["block-2@drp-pms", "2026-10-10", "2026-10-12", "Blocked"],
    ]
  );
});
