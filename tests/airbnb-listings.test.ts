import { test } from "node:test";
import assert from "node:assert/strict";
import { airbnbListingId, parseListingRows } from "@/lib/ical/listings";

const LINK_A = "https://www.airbnb.com/calendar/ical/12345678.ics?s=abc";
const LINK_B = "https://www.airbnb.ae/calendar/ical/87654321.ics?s=def";

const form = (rows: [string, string, string, string][]) => ({
  building: rows.map((r) => r[0]),
  unitNumber: rows.map((r) => r[1]),
  bedrooms: rows.map((r) => r[2]),
  link: rows.map((r) => r[3]),
});

test("the listing number is read from an Airbnb export link", () => {
  assert.equal(airbnbListingId(LINK_A), "12345678");
  assert.equal(airbnbListingId("https://www.airbnb.com/rooms/12345678"), null);
  assert.equal(airbnbListingId("not a url"), null);
});

test("filled rows are kept with their form position; empty rows are skipped", () => {
  const { rows, errors } = parseListingRows(
    form([
      ["  Marina   Gate 1 ", " 2807 ", "2", LINK_A],
      ["", "", "1", ""],
      ["Palm Views", "S-04", "0", LINK_B],
    ])
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [
    { row: 1, building: "Marina Gate 1", unitNumber: "2807", bedrooms: 2, link: LINK_A },
    { row: 3, building: "Palm Views", unitNumber: "S-04", bedrooms: 0, link: LINK_B },
  ]);
});

test("each problem names its row, and nothing passes until all are fixed", () => {
  const { errors } = parseListingRows(
    form([
      ["Marina Gate 1", "2807", "2", "https://evil.example/calendar.ics"],
      ["", "101", "1", LINK_A],
      ["Marina Gate 1", "", "1", ""],
      ["marina gate 1", "101", "1", LINK_B],
      ["Marina gate 1", "101", "1", LINK_B],
    ])
  );
  assert.deepEqual(errors, [
    "Row 1: that is not an Airbnb calendar link.",
    "Row 2: enter the building or community.",
    "Row 3: paste the listing's Airbnb calendar link.",
    "Row 3: enter the unit number.",
    "Row 5: the same Airbnb link is already in row 4.",
    "Row 5: Marina gate 1 101 is already in row 4.",
  ]);
});

test("an empty form asks for a listing", () => {
  assert.deepEqual(parseListingRows(form([["", "", "1", ""]])).errors, ["Add at least one listing."]);
});
