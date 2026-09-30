"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { syncUnit } from "@/lib/ical/sync";
import { parseListingRows, type ListingRow } from "@/lib/ical/listings";

export interface ListingResult {
  row: number;
  label: string;
  link: string;
  unitId?: string;
  outcome: "added" | "linked" | "failed";
  message: string;
}

/** The prices filled in on a row, as unit columns; blanks leave a unit's own. */
function priceColumns({ prices }: ListingRow) {
  return {
    ...(prices.nightly !== undefined ? { base_nightly_rate_aed: prices.nightly } : {}),
    ...(prices.weekend !== undefined ? { weekend_rate_aed: prices.weekend } : {}),
    ...(prices.cleaning !== undefined ? { cleaning_fee_aed: prices.cleaning } : {}),
    ...(prices.weeklyDiscount !== undefined ? { weekly_discount_pct: prices.weeklyDiscount } : {}),
    ...(prices.monthlyDiscount !== undefined ? { monthly_discount_pct: prices.monthlyDiscount } : {}),
  };
}

export type AddListingsState = { errors?: string[]; results?: ListingResult[] };

/** Airbnb feeds are fetched a few at a time so a long list stays quick. */
const SYNC_CONCURRENCY = 4;

/**
 * Adds Airbnb listings as holiday-home units in one go: each row finds (or
 * creates) its building, creates the unit with the Airbnb calendar link, and
 * runs the first sync so its reservations appear straight away. The first
 * sync of a unit never sends booking notifications, so a long list does not
 * flood anyone. Owners are linked afterwards, on each unit.
 */
export async function addAirbnbListings(
  _prev: AddListingsState,
  formData: FormData
): Promise<AddListingsState> {
  const profile = await requireProfile();
  if (!can(profile.role, "units.manage") || !can(profile.role, "properties.manage")) {
    return { errors: ["You do not have permission to add units."] };
  }

  const all = (name: string) => formData.getAll(name).map(String);
  const { rows, errors } = parseListingRows({
    building: all("building"),
    unitNumber: all("unitNumber"),
    bedrooms: all("bedrooms"),
    nightly: all("nightly"),
    weekend: all("weekend"),
    cleaning: all("cleaning"),
    weeklyDiscount: all("weeklyDiscount"),
    monthlyDiscount: all("monthlyDiscount"),
    link: all("link"),
  });
  if (errors.length) return { errors };

  const supabase = await createClient();

  // A link already connected to a unit would import the same stays twice.
  const { data: taken } = await supabase
    .from("units")
    .select("unit_number, airbnb_ical_url, properties(name)")
    .in("airbnb_ical_url", rows.map((r) => r.link));
  const takenBy = new Map(
    (taken ?? []).map((u) => [u.airbnb_ical_url, `${u.properties?.name ?? ""} ${u.unit_number}`.trim()])
  );
  const clashes = rows.flatMap((r) =>
    takenBy.has(r.link) ? [`Row ${r.row}: this Airbnb link is already connected to ${takenBy.get(r.link)}.`] : []
  );
  if (clashes.length) return { errors: clashes };

  const { data: properties, error: propertiesError } = await supabase
    .from("properties")
    .select("id, name")
    .eq("is_active", true);
  if (propertiesError) return { errors: [propertiesError.message] };
  const propertyByName = new Map((properties ?? []).map((p) => [p.name.trim().toLowerCase(), p.id]));

  async function propertyFor(name: string): Promise<string> {
    const key = name.toLowerCase();
    const existing = propertyByName.get(key);
    if (existing) return existing;
    const { data, error } = await supabase
      .from("properties")
      .insert({ name, kind: "building" })
      .select("id")
      .single();
    if (error) throw new Error(`Could not add the building: ${error.message}`);
    propertyByName.set(key, data.id);
    return data.id;
  }

  async function addUnit(row: ListingRow, propertyId: string): Promise<Omit<ListingResult, "row" | "label" | "link">> {
    const { data: existing } = await supabase
      .from("units")
      .select("id, operating_mode, airbnb_ical_url")
      .eq("property_id", propertyId)
      .eq("unit_number", row.unitNumber)
      .maybeSingle();

    if (existing) {
      if (existing.airbnb_ical_url) {
        return { unitId: existing.id, outcome: "failed", message: "This unit already has an Airbnb link." };
      }
      if (existing.operating_mode === "long_term" || existing.operating_mode === "not_operating") {
        return {
          unitId: existing.id,
          outcome: "failed",
          message: "This unit exists as a long-term unit. Edit it to Short term or Both first.",
        };
      }
      const { data, error } = await supabase
        .from("units")
        .update({ airbnb_ical_url: row.link, ...priceColumns(row) })
        .eq("id", existing.id)
        .select("id");
      if (error || !data?.length) {
        return { unitId: existing.id, outcome: "failed", message: error?.message ?? "You do not have access to this unit." };
      }
      return { unitId: existing.id, outcome: "linked", message: "Existing unit connected to Airbnb." };
    }

    const { data, error } = await supabase
      .from("units")
      .insert({
        property_id: propertyId,
        unit_number: row.unitNumber,
        kind: row.bedrooms === 0 ? "studio" : "apartment",
        bedrooms: row.bedrooms,
        furnishing: "fully_furnished",
        operating_mode: "short_term",
        airbnb_ical_url: row.link,
        ...priceColumns(row),
      })
      .select("id")
      .single();
    if (error) return { outcome: "failed", message: error.message };
    return { unitId: data.id, outcome: "added", message: "Unit added." };
  }

  // Buildings and units are created one row at a time, so two rows naming
  // the same new building share it rather than racing to create it twice.
  const results: ListingResult[] = [];
  for (const row of rows) {
    const label = `${row.building} · ${row.unitNumber}`;
    try {
      results.push({ row: row.row, label, link: row.link, ...(await addUnit(row, await propertyFor(row.building))) });
    } catch (error) {
      results.push({ row: row.row, label, link: row.link, outcome: "failed", message: (error as Error).message });
    }
  }

  const toSync = results.filter((r) => r.outcome !== "failed" && r.unitId);
  for (let i = 0; i < toSync.length; i += SYNC_CONCURRENCY) {
    await Promise.all(
      toSync.slice(i, i + SYNC_CONCURRENCY).map(async (r) => {
        const sync = await syncUnit(supabase, r.unitId!, r.link);
        const stays = sync.created ?? 0;
        r.message +=
          sync.ok || stays
            ? ` ${stays} Airbnb ${stays === 1 ? "stay" : "stays"} imported.`
            : ` The first sync failed: ${(sync.errors[0] ?? "unknown error").replace(/\.$/, "")}. It retries every 15 minutes.`;
      })
    );
  }

  revalidatePath("/calendar-sync");
  revalidatePath("/units");
  revalidatePath("/properties");
  revalidatePath("/bookings");
  return { results };
}
