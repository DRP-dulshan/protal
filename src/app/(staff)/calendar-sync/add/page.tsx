import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { FEED_CHANNEL_NAME } from "@/lib/ical/url";
import { AddListingsForm } from "./add-listings-form";

export const metadata = { title: "Add listings" };

export default async function AddListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string }>;
}) {
  const channel = (await searchParams).channel === "booking_com" ? "booking_com" : "airbnb";
  const site = FEED_CHANNEL_NAME[channel];
  const supabase = await createClient();
  const [, { data }] = await Promise.all([
    requireCapability("properties.manage"),
    supabase.from("properties").select("name").eq("is_active", true).order("name"),
  ]);

  return (
    <>
      <PageHeader
        breadcrumb={[
          { label: "Calendar sync", href: channel === "airbnb" ? "/calendar-sync" : "/calendar-sync?channel=booking_com" },
          { label: `Add ${site} listings` },
        ]}
        title={`Add ${site} listings`}
        description={`Bring each ${site} listing in as a holiday-home unit, with its calendar connected. Link the owners afterwards.`}
      />
      <AddListingsForm key={channel} buildings={(data ?? []).map((p) => p.name)} channel={channel} />
    </>
  );
}
