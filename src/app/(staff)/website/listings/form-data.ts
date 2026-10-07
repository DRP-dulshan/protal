import { createClient } from "@/lib/supabase/server";

/** What the listing form offers: areas and agents already used, and units to link. */
export async function listingFormOptions() {
  const supabase = await createClient();
  const [listings, units] = await Promise.all([
    supabase.from("website_listings").select("area, agent"),
    supabase
      .from("v_units_overview")
      .select("id, unit_number, property_name")
      .eq("is_active", true)
      .order("property_name")
      .order("unit_number"),
  ]);
  const distinct = (values: (string | null)[]) =>
    [...new Set(values.filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) => a.localeCompare(b));
  return {
    areas: distinct((listings.data ?? []).map((l) => l.area)),
    agents: distinct((listings.data ?? []).map((l) => l.agent)),
    units: (units.data ?? []).map((u) => ({ id: u.id!, label: `${u.property_name} · ${u.unit_number}` })),
  };
}
