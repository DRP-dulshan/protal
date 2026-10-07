import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  fromWebsiteListing,
  slugify,
  toFeatures,
  toParagraphs,
  toWebsiteListing,
  type ListingRow,
} from "@/lib/listings";

// The website's own data file (new-home: data/imported/listings.json, Oct 2026).
const website = JSON.parse(readFileSync(new URL("./fixtures/website-listings.json", import.meta.url), "utf8")) as Record<
  string,
  unknown
>[];

test("slugify makes website addresses", () => {
  assert.equal(slugify("2 BR Apartment for Rent | Marina Gate!"), "2-br-apartment-for-rent-marina-gate");
  assert.equal(slugify("  Café & Pool  "), "cafe-and-pool");
  assert.equal(slugify("***"), "");
});

test("paragraphs and features", () => {
  assert.deepEqual(toParagraphs("First line\nsame paragraph.\n\n  Second.  \n\n\n"), ["First line same paragraph.", "Second."]);
  assert.deepEqual(toFeatures("Balcony\nCentral A/C, Pool\nbalcony\n\n"), ["Balcony", "Central A/C", "Pool"]);
});

test("every listing the website shows survives the trip through the portal unchanged", () => {
  const shown = website.filter((r) => r.type !== "Commercial" && r.size);
  assert.ok(shown.length > 90);
  for (const original of shown) {
    const row = fromWebsiteListing(original);
    assert.ok(row, `readable: ${original.slug}`);
    const back = toWebsiteListing({
      ...row,
      id: "x",
      status: "published",
      unit_id: null,
      created_by: null,
      updated_by: null,
      created_at: "",
      updated_at: "",
    } as ListingRow);
    const expected = {
      ...original,
      // The portal stores the title as the website displays it.
      title: String(original.title).replace(/\s+l\s+/g, " | ").replace(/\s*\|\s*$/, "").trim(),
      description: (original.description as string[]).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean),
    };
    for (const key of Object.keys(expected) as (keyof typeof expected)[]) {
      assert.deepEqual(back[key as keyof typeof back], expected[key], `${original.slug}: ${String(key)}`);
    }
  }
});

test("what the website does not show is left out of an import", () => {
  const commercial = website.find((r) => r.type === "Commercial");
  assert.equal(fromWebsiteListing(commercial), null);
  assert.equal(fromWebsiteListing({ slug: "Bad Slug", title: "x" }), null);
  assert.equal(fromWebsiteListing(null), null);
});
