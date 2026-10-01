"use client";

import * as React from "react";
import Link from "next/link";
import { useActionState } from "react";
import { ClipboardPaste, Plus, Trash2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { airbnbListingId, MAX_LISTINGS } from "@/lib/ical/listings";
import { addAirbnbListings, type AddListingsState } from "../actions";
import { FEED_CHANNEL_NAME, type FeedChannel } from "@/lib/ical/url";

/** What differs between the Airbnb and Booking.com versions of the form. */
const COPY: Record<FeedChannel, { where: React.ReactNode; placeholder: string; pricing: string }> = {
  airbnb: {
    where: (
      <>
        For each listing on Airbnb: open its <span className="font-medium">Calendar → Availability →
        Connect calendars → Export calendar</span> and copy the link.
      </>
    ),
    placeholder: "https://www.airbnb.com/calendar/ical/12345678.ics?s=…",
    pricing: "copy them from the listing's Pricing on Airbnb",
  },
  booking_com: {
    where: (
      <>
        For each property in the Booking.com extranet: open <span className="font-medium">Rates &amp;
        Availability → Sync calendars → Export calendar</span> and copy the link. A unit that is
        already in the portal (from Airbnb) is connected, not duplicated - use the same building
        and unit number.
      </>
    ),
    placeholder: "https://admin.booking.com/hotel/hoteladmin/ical.html?t=…",
    pricing: "the rates D|R|P quotes for direct bookings",
  },
};

interface Row {
  key: number;
  building: string;
  unitNumber: string;
  bedrooms: string;
  link: string;
  nightly: string;
  weekend: string;
  cleaning: string;
  weeklyDiscount: string;
  monthlyDiscount: string;
}

type PriceKey = "nightly" | "weekend" | "cleaning" | "weeklyDiscount" | "monthlyDiscount";

/** Optional prices for direct bookings, as on Airbnb's Pricing page. */
const PRICE_INPUTS: { key: PriceKey; label: string; placeholder: string; max?: number }[] = [
  { key: "nightly", label: "Per night (AED)", placeholder: "e.g. 340" },
  { key: "weekend", label: "Weekend (AED)", placeholder: "e.g. 347" },
  { key: "cleaning", label: "Cleaning (AED)", placeholder: "e.g. 150" },
  { key: "weeklyDiscount", label: "Weekly disc. %", placeholder: "e.g. 5", max: 99 },
  { key: "monthlyDiscount", label: "Monthly disc. %", placeholder: "e.g. 15", max: 99 },
];

let nextKey = 0;
const emptyRow = (link = ""): Row => ({
  key: nextKey++,
  building: "",
  unitNumber: "",
  bedrooms: "1",
  link,
  nightly: "",
  weekend: "",
  cleaning: "",
  weeklyDiscount: "",
  monthlyDiscount: "",
});

const BEDROOMS = [
  ["0", "Studio"],
  ["1", "1 bed"],
  ["2", "2 beds"],
  ["3", "3 beds"],
  ["4", "4 beds"],
  ["5", "5 beds"],
  ["6", "6+ beds"],
] as const;

function SubmitButton({ count, pending }: { count: number; pending: boolean }) {
  return (
    <Button type="submit" disabled={pending || count === 0}>
      {pending
        ? "Adding and syncing…"
        : `Add ${count} ${count === 1 ? "listing" : "listings"}`}
    </Button>
  );
}

export function AddListingsForm({
  buildings,
  channel = "airbnb",
}: {
  buildings: string[];
  channel?: FeedChannel;
}) {
  const copy = COPY[channel];
  const site = FEED_CHANNEL_NAME[channel];
  const [rows, setRows] = React.useState<Row[]>(() => [emptyRow()]);
  const [pasteOpen, setPasteOpen] = React.useState(false);
  const [pasted, setPasted] = React.useState("");
  const [state, formAction, pending] = useActionState(
    async (prev: AddListingsState, formData: FormData) => {
      const next = await addAirbnbListings(prev, formData);
      // Rows that went in are cleared; anything that failed stays to fix.
      if (next.results) {
        const failed = new Set(next.results.filter((r) => r.outcome === "failed").map((r) => r.row));
        setRows((current) => {
          const keep = current.filter((_, i) => failed.has(i + 1));
          return keep.length ? keep : [emptyRow()];
        });
      }
      return next;
    },
    {}
  );

  const filled = rows.filter((r) => r.link.trim() || r.building.trim() || r.unitNumber.trim()).length;
  const update = (key: number, patch: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function addPastedLinks() {
    const links = pasted.match(/https:\/\/\S+/g) ?? [];
    if (links.length) {
      setRows((current) => {
        const kept = current.filter((r) => r.link.trim() || r.building.trim() || r.unitNumber.trim());
        return [...kept, ...links.map((l) => emptyRow(l))].slice(0, MAX_LISTINGS);
      });
    }
    setPasted("");
    setPasteOpen(false);
  }

  return (
    <div className="space-y-5">
      {state.results && state.results.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Result</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-[var(--border)]">
              {state.results.map((r) => (
                <li key={r.row} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {r.unitId ? (
                        <Link href={`/units/${r.unitId}?tab=calendar`} className="text-sm font-medium hover:underline">
                          {r.label}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium">{r.label}</span>
                      )}
                      {r.outcome === "failed" ? (
                        <Badge variant="danger">Not added</Badge>
                      ) : (
                        <Badge variant="success">{r.outcome === "added" ? "Added" : "Connected"}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)]">{r.message}</p>
                  </div>
                  {r.unitId && r.outcome !== "failed" && (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/units/${r.unitId}/edit`}>
                        <UserPlus className="size-4" />
                        Link owner
                      </Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Listings</CardTitle>
          <Button type="button" size="sm" variant="outline" onClick={() => setPasteOpen((o) => !o)}>
            <ClipboardPaste className="size-4" />
            Paste several links
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-[var(--muted-foreground)]">
            {copy.where} Buildings that do not exist yet are created.
          </p>

          {pasteOpen && (
            <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
              <Label htmlFor="pasted">{site} calendar links, one per line</Label>
              <textarea
                id="pasted"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={5}
                className="w-full rounded-md border border-[var(--input)] bg-[var(--background)] px-3 py-2 font-mono text-xs"
                placeholder={`${copy.placeholder}\n${copy.placeholder}`}
              />
              <Button type="button" size="sm" onClick={addPastedLinks}>
                Add rows
              </Button>
            </div>
          )}

          {state.errors && state.errors.length > 0 && (
            <div
              role="alert"
              className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
            >
              <ul className="list-disc space-y-0.5 pl-4">
                {state.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Submitted by hand rather than through the form action, which would
              reset the form afterwards and leave the bedroom selects of rows
              kept for fixing showing the first option instead of their value. */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              React.startTransition(() => formAction(data));
            }}
          >
            <input type="hidden" name="channel" value={channel} />
            <datalist id="buildings">
              {buildings.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>

            {rows.map((row, i) => {
              const listing = airbnbListingId(row.link);
              return (
                <div key={row.key} className="rounded-lg border border-[var(--border)] p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
                      Row {i + 1}
                      {channel === "airbnb" && listing && (
                        <span className="ml-2 normal-case tracking-normal">Airbnb listing {listing}</span>
                      )}
                    </span>
                    {rows.length > 1 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove row ${i + 1}`}
                        onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
                    <div className="space-y-1">
                      <Label htmlFor={`building-${row.key}`}>Building or community</Label>
                      <Input
                        id={`building-${row.key}`}
                        name="building"
                        list="buildings"
                        value={row.building}
                        onChange={(e) => update(row.key, { building: e.target.value })}
                        placeholder="e.g. Marina Gate 1"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`unit-${row.key}`}>Unit number</Label>
                      <Input
                        id={`unit-${row.key}`}
                        name="unitNumber"
                        value={row.unitNumber}
                        onChange={(e) => update(row.key, { unitNumber: e.target.value })}
                        placeholder="e.g. 2807"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`bedrooms-${row.key}`}>Bedrooms</Label>
                      <Select
                        id={`bedrooms-${row.key}`}
                        name="bedrooms"
                        value={row.bedrooms}
                        onChange={(e) => update(row.key, { bedrooms: e.target.value })}
                      >
                        {BEDROOMS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  <div className="mt-2 space-y-1">
                    <Label htmlFor={`link-${row.key}`}>{site} calendar link</Label>
                    <Input
                      id={`link-${row.key}`}
                      name="link"
                      type="url"
                      value={row.link}
                      onChange={(e) => update(row.key, { link: e.target.value })}
                      placeholder={copy.placeholder}
                      className="font-mono text-xs"
                    />
                  </div>
                  <fieldset className="mt-3">
                    <legend className="mb-1 text-xs text-[var(--muted-foreground)]">
                      Prices for direct bookings (optional - {copy.pricing})
                    </legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {PRICE_INPUTS.map((f) => (
                        <div key={f.key} className="space-y-1">
                          <Label htmlFor={`${f.key}-${row.key}`} className="text-xs">
                            {f.label}
                          </Label>
                          <Input
                            id={`${f.key}-${row.key}`}
                            name={f.key}
                            type="number"
                            min="0"
                            max={f.max}
                            step="0.01"
                            value={row[f.key]}
                            onChange={(e) => update(row.key, { [f.key]: e.target.value })}
                            placeholder={f.placeholder}
                          />
                        </div>
                      ))}
                    </div>
                  </fieldset>
                </div>
              );
            })}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rows.length >= MAX_LISTINGS}
                onClick={() => setRows((current) => [...current, emptyRow()])}
              >
                <Plus className="size-4" />
                Add another listing
              </Button>
              <SubmitButton count={filled} pending={pending} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
