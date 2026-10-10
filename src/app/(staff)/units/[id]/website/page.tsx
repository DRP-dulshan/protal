import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { imagesOf } from "@/lib/website-homes";
import { seasonsToText } from "@/lib/website-options";
import { WebsiteForm } from "./website-form";

export const metadata = { title: "Unit on the website" };

export default async function UnitWebsitePage({ params }: { params: Promise<{ id: string }> }) {
  await requireCapability("units.manage");
  const { id } = await params;
  const supabase = await createClient();
  const { data: u } = await supabase.from("units").select("*, properties(name)").eq("id", id).maybeSingle();
  if (!u) notFound();

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[{ label: "Units", href: "/units" }, { label: u.unit_number, href: `/units/${u.id}` }, { label: "Website" }]}
        title={`${u.unit_number} on the website`}
        description="What guests see on the Holiday Homes website. Bookings made there land in this unit's calendar."
      />
      {!(Number(u.base_nightly_rate_aed) > 0) && (
        <p className="rounded-md border border-[var(--border)] p-3 text-sm">
          Set a nightly rate and max guests in the unit&apos;s <Link className="underline" href={`/units/${u.id}/edit`}>details</Link> before publishing.
        </p>
      )}
      <WebsiteForm
        unitId={u.id}
        d={{
          published: u.website_published,
          title: u.website_title ?? "",
          slug: u.website_slug ?? "",
          type: u.website_type ?? "",
          area: u.website_area ?? "",
          building: u.website_building ?? "",
          tag: u.website_tag ?? "",
          description: u.website_description ?? "",
          highlights: (u.website_highlights ?? []).join("\n"),
          houseRules: (u.website_house_rules ?? []).join("\n"),
          amenities: u.website_amenities ?? [],
          images: imagesOf(u),
          lat: u.website_lat == null ? "" : String(u.website_lat),
          lng: u.website_lng == null ? "" : String(u.website_lng),
          mapsUrl: u.website_maps_url ?? "",
          checkIn: u.website_check_in ?? "15:00",
          checkOut: u.website_check_out ?? "11:00",
          seasons: seasonsToText(u.website_seasons),
        }}
      />
    </div>
  );
}
