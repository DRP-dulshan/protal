import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAirbnbListing, listingBookmarklet } from "@/lib/airbnb/listing-collect";
import {
  factsFrom,
  fullSizePhotoUrl,
  htmlToText,
  isAirbnbPhotoUrl,
  listingIdOf,
  mapAirbnbAmenities,
  mergeListing,
  parseAirbnbListing,
  parseAirbnbListingText,
  suggestArea,
  suggestSlug,
  suggestType,
} from "@/lib/airbnb/listing-page";
import { downloadAirbnbPhoto } from "@/lib/airbnb/listing-photos";
import { WEBSITE_AMENITIES } from "@/lib/website-options";

const PIC = (n: number) => `https://a0.muscache.com/im/pictures/miso/Hosting-12345/original/photo-${n}.jpeg`;

// The JSON Airbnb puts in a listing page, cut down to the shapes the
// collector looks for (section names and nesting change; these do not).
const STATE = {
  niobeClientData: [
    [
      "StaysPdpSections",
      {
        data: {
          presentation: {
            stayProductDetailPage: {
              sections: {
                sections: [
                  { section: { __typename: "PdpTitleSection", title: "Marina Gate 1 · 2BR with Marina View" } },
                  {
                    section: {
                      __typename: "PdpOverviewV2Section",
                      overviewItems: [{ title: "4 guests" }, { title: "2 bedrooms" }, { title: "2 beds" }, { title: "2.5 baths" }],
                    },
                  },
                  {
                    section: {
                      __typename: "PdpPhotoTourSection",
                      mediaItems: [
                        { baseUrl: `${PIC(1)}?im_w=720` },
                        { baseUrl: PIC(2) },
                        { baseUrl: PIC(1) },
                        { baseUrl: "https://a0.muscache.com/im/pictures/user/User-9/original/host.jpeg" },
                      ],
                    },
                  },
                  {
                    section: {
                      __typename: "PdpDescriptionSection",
                      htmlDescription: { htmlText: "Bright flat.<br /><br /><b>The space</b><br />Marina &amp; sea views." },
                    },
                  },
                  {
                    section: {
                      __typename: "AmenitiesSection",
                      seeAllAmenitiesGroups: [
                        {
                          amenities: [
                            { __typename: "Amenity", title: "Wifi", available: true },
                            { __typename: "Amenity", title: "Shared outdoor pool - available all year", available: true },
                            { __typename: "Amenity", title: "Carbon monoxide alarm", available: false },
                            { __typename: "Amenity", title: "Hair dryer", available: true },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
              personCapacity: 4,
            },
          },
        },
      },
    ],
  ],
};

/** Just enough of a DOM for the collector. */
function fakeDoc({ scripts = [] as string[], imgs = [] as Record<string, string>[], h1 = "", meta = {} as Record<string, string>, text = "" }) {
  const el = (attrs: Record<string, string>, textContent = "") => ({
    textContent,
    getAttribute: (k: string) => attrs[k] ?? null,
  });
  return {
    body: { innerText: text },
    querySelectorAll: (sel: string) =>
      sel.startsWith("script") ? scripts.map((s) => el({}, s)) : sel.startsWith("img") ? imgs.map((a) => el(a)) : [],
    querySelector: (sel: string) => {
      if (sel === "h1") return h1 ? el({}, h1) : null;
      const m = sel.match(/^meta\[(property|name)="(.+)"\]$/);
      return m && meta[m[2]] ? el({ content: meta[m[2]] }) : null;
    },
  } as unknown as Document;
}

test("collects a listing from the page's JSON", () => {
  const sent = collectAirbnbListing(
    fakeDoc({
      scripts: [JSON.stringify(STATE), "not json"],
      imgs: [{ src: PIC(3), srcset: `${PIC(2)}?im_w=480 480w, ${PIC(4)}?im_w=960 960w` }],
      h1: "Ignored: the JSON title wins",
      text: "Marina Gate 1\nShare\nSave",
    }),
    "https://www.airbnb.com/rooms/12345?check_in=2026-11-01",
    true
  );
  assert.equal(sent.title, "Marina Gate 1 · 2BR with Marina View");
  assert.equal(sent.guests, 4);
  assert.deepEqual(sent.amenities, ["Wifi", "Shared outdoor pool - available all year", "Hair dryer"]);
  assert.deepEqual(sent.photos, [PIC(1), PIC(2), PIC(3), PIC(4)]);
  assert.ok(sent.facts.includes("2 bedrooms") && sent.facts.includes("2.5 baths"));
  assert.match(sent.desc ?? "", /The space/);
  assert.equal(sent.text, "Marina Gate 1\nShare\nSave");
});

test("collects schema.org data and falls back to the heading", () => {
  const ld = {
    "@type": "VacationRental",
    name: "Palm villa",
    description: "Private pool villa.",
    image: [PIC(7)],
    numberOfBedrooms: 4,
    amenityFeature: [
      { "@type": "LocationFeatureSpecification", name: "Private pool", value: true },
      { "@type": "LocationFeatureSpecification", name: "Elevator", value: false },
    ],
  };
  const sent = collectAirbnbListing(fakeDoc({ scripts: [JSON.stringify(ld)], h1: "Heading" }), "https://www.airbnb.ae/rooms/9", false);
  assert.equal(sent.title, "Palm villa");
  assert.equal(sent.desc, "Private pool villa.");
  assert.deepEqual(sent.amenities, ["Private pool"]);
  assert.deepEqual(sent.photos, [PIC(7)]);
  assert.equal(sent.text, "");

  const bare = collectAirbnbListing(fakeDoc({ h1: " Studio in JVC ", meta: { "og:image": PIC(8) } }), "u", false);
  assert.equal(bare.title, "Studio in JVC");
  assert.deepEqual(bare.photos, [PIC(8)]);
});

test("keeps what it sends small enough for an address", () => {
  const sent = collectAirbnbListing(
    fakeDoc({
      scripts: [JSON.stringify({ htmlDescription: { htmlText: "x".repeat(20000) } })],
      text: "y".repeat(15000),
    }),
    "u",
    true
  );
  assert.ok(encodeURIComponent(JSON.stringify(sent)).length <= 60000);
  assert.ok((sent.desc ?? "").length >= 10000);
});

test("the bookmarklet is runnable code that opens the portal", () => {
  const code = listingBookmarklet("https://admin.example.com/units/from-airbnb");
  assert.ok(code.startsWith("javascript:"));
  const js = decodeURIComponent(code.slice("javascript:".length));
  let opened = "";
  const run = new Function("document", "location", "window", "alert", js);
  run(fakeDoc({ scripts: [JSON.stringify(STATE)] }), { href: "https://www.airbnb.com/rooms/12345" }, { open: (u: string) => (opened = u) }, () => {
    throw new Error("alerted");
  });
  assert.ok(opened.startsWith("https://admin.example.com/units/from-airbnb#"));
  const sent = JSON.parse(decodeURIComponent(opened.split("#")[1]));
  assert.equal(parseAirbnbListing(sent).title, "Marina Gate 1 · 2BR with Marina View");
});

test("parses what the button sent", () => {
  const sent = collectAirbnbListing(fakeDoc({ scripts: [JSON.stringify(STATE)] }), "https://www.airbnb.com/rooms/12345?x=1", false);
  const l = parseAirbnbListing(sent);
  assert.deepEqual(l, {
    url: "https://www.airbnb.com/rooms/12345?x=1",
    listingId: "12345",
    title: "Marina Gate 1 · 2BR with Marina View",
    description: "Bright flat.\n\nThe space\nMarina & sea views.",
    bedrooms: 2,
    bathrooms: 2.5,
    guests: 4,
    amenities: ["Wifi", "Shared outdoor pool - available all year", "Hair dryer"],
    photos: [PIC(1), PIC(2)],
  });
});

test("accepts anything without throwing", () => {
  for (const junk of [null, 5, "text", [], { photos: "x", amenities: [1, null], guests: "4", title: 3 }]) {
    const l = parseAirbnbListing(junk);
    assert.equal(l.title, null);
    assert.deepEqual(l.photos, []);
  }
  const l = parseAirbnbListing({ photos: ["http://a0.muscache.com/a.jpg", "https://evil.com/im/pictures/a.jpg", PIC(1), PIC(1)] });
  assert.deepEqual(l.photos, [PIC(1)]);
  // A sharing title is not the listing's name.
  assert.equal(parseAirbnbListing({ title: "Rental unit in Dubai · ★4.92 · 2 bedrooms · 2 beds" }).title, null);
});

test("reads a copied listing page", () => {
  const text = `Skip to content
Airbnb
Marina Gate 1 · 2BR with Marina View
Share
Save
Show all photos
Entire rental unit in Dubai, United Arab Emirates
4 guests · 2 bedrooms · 2 beds · 2 baths
About this space
Bright two-bedroom flat in Marina Gate.
The space
Floor-to-ceiling windows.
Show more
What this place offers
Marina view
Kitchen
Wifi
Free parking on premises
Unavailable: Carbon monoxide alarm
Show all 42 amenities
https://www.airbnb.com/rooms/12345`;
  const l = parseAirbnbListingText(text);
  assert.equal(l.title, "Marina Gate 1 · 2BR with Marina View");
  assert.equal(l.listingId, "12345");
  assert.deepEqual([l.bedrooms, l.bathrooms, l.guests], [2, 2, 4]);
  assert.equal(l.description, "Bright two-bedroom flat in Marina Gate.\n\nThe space\n\nFloor-to-ceiling windows.");
  assert.deepEqual(l.amenities, ["Marina view", "Kitchen", "Wifi", "Free parking on premises"]);
  assert.deepEqual(l.photos, []);
  // The same text sent by the button, with nothing else found.
  assert.equal(parseAirbnbListing({ text }).title, l.title);
});

test("maps Airbnb amenities to the website's", () => {
  const { ids, unmatched } = mapAirbnbAmenities([
    "Fast wifi – 500 Mbps",
    "Private outdoor pool - available all year, heated",
    "Shared indoor pool",
    "Pool",
    "Sea view",
    "City skyline view",
    "Free parking on premises",
    "Paid parking off premises",
    "Shared gym in building",
    "Free washer – In unit",
    "Dryer",
    "Elevator",
    "Housekeeping - available at extra cost",
    "Central air conditioning",
    "Kitchen",
    "Hair dryer",
    "Self check-in",
    "Smart lock",
  ]);
  assert.deepEqual(ids, ["wifi", "pool", "sharedPool", "seaView", "skylineView", "parking", "gym", "washer", "airCon", "kitchen", "smartLock"]);
  assert.deepEqual(unmatched, ["Pool", "Paid parking off premises", "Elevator", "Housekeeping - available at extra cost", "Hair dryer", "Self check-in"]);
  for (const id of ids) assert.ok(id in WEBSITE_AMENITIES, id);
});

test("only Airbnb's photo host is accepted, at full size", () => {
  assert.equal(fullSizePhotoUrl(`${PIC(1)}?im_w=720&aki_policy=large`), PIC(1));
  assert.ok(isAirbnbPhotoUrl("https://a0.muscache.com/x.jpg"));
  for (const bad of [
    "http://a0.muscache.com/x.jpg",
    "https://muscache.com.evil.com/x.jpg",
    "https://evilmuscache.com/x.jpg",
    "https://a0.muscache.com:8443/x.jpg",
    "https://user:pw@a0.muscache.com/x.jpg",
    "javascript:alert(1)",
    "not a url",
  ]) {
    assert.equal(isAirbnbPhotoUrl(bad), false, bad);
  }
  assert.equal(fullSizePhotoUrl("https://a0.muscache.com/im/pictures/user/User-1/original/a.jpg"), null);
});

test("reads listing numbers and facts", () => {
  assert.equal(listingIdOf("https://www.airbnb.com/rooms/53312345678901234?adults=2"), "53312345678901234");
  assert.equal(listingIdOf("https://www.airbnb.co.uk/hosting/listings/editor/987654/details/photo-tour"), "987654");
  assert.equal(listingIdOf("https://example.com/rooms/1234"), null);
  assert.deepEqual(factsFrom(["Studio · 1 bed · 1 bath", "2 guests"]), { bedrooms: 0, bathrooms: 1, guests: 2 });
  assert.deepEqual(factsFrom(["16+ guests", "1 private bath"]), { bedrooms: null, bathrooms: 1, guests: 16 });
  assert.equal(htmlToText("A&#39;s &#x1F30A; <i>view</i>&nbsp;here<p>x</p>"), "A's 🌊 view here\n\nx");
});

test("suggests a web address, area and type", () => {
  const slug = suggestSlug("Marina Gate 1 · 2BR with Marina View ✨ & Pool");
  assert.equal(slug, "marina-gate-1-2br-with-marina-view-and-pool");
  assert.match(slug, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.ok(suggestSlug("a ".repeat(100)).length <= 80);
  assert.equal(suggestSlug(null), "");
  assert.equal(suggestArea({ title: "Marina Gate 1 · 2BR" }), "Dubai Marina");
  assert.equal(suggestArea({ title: "Cosy flat near JBR and Downtown" }), "");
  assert.equal(suggestArea({ title: "Cosy flat" }), "");
  assert.equal(suggestType({ title: "Signature Villa on the Palm", bedrooms: 5 }), "villa");
  assert.equal(suggestType({ title: "Cosy home", bedrooms: 0 }), "studio");
  assert.equal(suggestType({ title: "Cosy home", bedrooms: 2 }), "");
});

test("puts the listing into the Website form without overriding staff choices", () => {
  const d = {
    title: "Old",
    slug: "",
    type: "penthouse",
    area: "",
    description: "Old text",
    amenities: ["concierge", "wifi"],
    images: ["https://x.supabase.co/storage/v1/object/public/listing-photos/old.jpg"],
    published: false,
  };
  const l = parseAirbnbListing(collectAirbnbListing(fakeDoc({ scripts: [JSON.stringify(STATE)] }), "u", false));
  const stored = ["https://x.supabase.co/storage/v1/object/public/listing-photos/a.jpg"];
  const m = mergeListing(d, l, stored, false);
  assert.equal(m.title, "Marina Gate 1 · 2BR with Marina View");
  assert.equal(m.slug, "marina-gate-1-2br-with-marina-view");
  assert.equal(m.type, "penthouse");
  assert.equal(m.area, "Dubai Marina");
  assert.deepEqual(m.amenities, ["concierge", "wifi", "sharedPool"]);
  assert.deepEqual(m.images, stored);
  assert.equal(m.published, false);
  assert.deepEqual(mergeListing(d, l, stored, true).images, [...d.images, ...stored]);
  // Nothing copied: the unit's photos stay.
  assert.deepEqual(mergeListing(d, l, [], false).images, d.images);
});

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const reply = (body: BodyInit, headers: Record<string, string>, status = 200) => async () =>
  new Response(body, { status, headers });

test("downloads a photo only from Airbnb, as a real image", async () => {
  let asked = "";
  const ok = await downloadAirbnbPhoto(`${PIC(1)}?im_w=720`, (async (u: string) => {
    asked = u;
    return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch);
  assert.equal(asked, PIC(1));
  assert.ok("bytes" in ok && ok.type === "image/jpeg" && ok.bytes.length === JPEG.length);

  const never = (async () => assert.fail("must not fetch")) as typeof fetch;
  assert.ok("error" in (await downloadAirbnbPhoto("https://evil.com/a.jpg", never)));
  assert.ok("error" in (await downloadAirbnbPhoto("http://a0.muscache.com/a.jpg", never)));

  const html = await downloadAirbnbPhoto(PIC(1), reply("<html>", { "content-type": "text/html" }) as typeof fetch);
  assert.ok("error" in html);
  const disguised = await downloadAirbnbPhoto(PIC(1), reply("<html>", { "content-type": "image/jpeg" }) as typeof fetch);
  assert.ok("error" in disguised);
  const moved = await downloadAirbnbPhoto(PIC(1), reply("", { location: "http://169.254.169.254/" }, 302) as typeof fetch);
  assert.ok("error" in moved);
  const big = await downloadAirbnbPhoto(PIC(1), reply(JPEG, { "content-type": "image/jpeg", "content-length": "20000000" }) as typeof fetch);
  assert.ok("error" in big);
  const huge = new Uint8Array(11 * 1024 * 1024);
  huge.set(JPEG);
  const streamed = await downloadAirbnbPhoto(PIC(1), reply(huge, { "content-type": "image/jpeg" }) as typeof fetch);
  assert.ok("error" in streamed);
});
