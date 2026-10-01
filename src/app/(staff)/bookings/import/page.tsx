import { requireCapability } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/shared";
import { ImportForm } from "./import-form";
import { ClearMatchButton } from "./clear-match";

export const metadata = { title: "Import Airbnb earnings" };

export default async function ImportAirbnbEarningsPage() {
  await requireCapability("bookings.manage");
  const supabase = await createClient();
  const { data: matched } = await supabase
    .from("units")
    .select("id, unit_number, airbnb_listing_name, properties(name)")
    .not("airbnb_listing_name", "is", null)
    .order("airbnb_listing_name");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }]}
        title="Import Airbnb earnings"
        description="Prices every Airbnb stay in the file at once, and adds past stays the calendar never had."
      />

      <Card className="mb-5">
        <CardContent className="space-y-2 p-5 text-sm">
          <p className="font-medium">Getting the file from Airbnb</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>In Airbnb, open Menu, then Earnings.</li>
            <li>
              Choose Transaction history. Export CSV from <strong>both</strong> the Paid and the
              Upcoming tab, with dates covering every current stay: a stay is on only one of them.
            </li>
            <li>Upload both files here, one after the other. Importing the same file again is safe.</li>
          </ol>
          <p className="text-[var(--muted-foreground)]">
            Each reservation&apos;s payout, Airbnb service fee, cleaning fee and Tourism Dirham
            are filled in, and the guest&apos;s name is added where the booking has none. Owners
            never see these amounts.
          </p>
          <p className="text-[var(--muted-foreground)]">
            <span className="font-medium text-[var(--foreground)]">Past stays:</span> the Airbnb
            calendar only brings current and future stays. Stays that already ended are added from
            this file as checked out, so they show in Bookings and in the owner&apos;s portal. To
            bring in older history, export the Paid tab with an earlier start date. The first time
            a listing appears you choose its unit.
          </p>
        </CardContent>
      </Card>

      <ImportForm />

      {(matched?.length ?? 0) > 0 && (
        <Card className="mt-5">
          <CardContent className="space-y-2 p-5 text-sm">
            <p className="font-medium">Airbnb listings matched to units</p>
            <ul className="divide-y divide-[var(--border)]">
              {matched!.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate">{u.airbnb_listing_name}</span>
                    <span className="text-xs text-[var(--muted-foreground)]">
                      {u.properties?.name} · {u.unit_number}
                    </span>
                  </span>
                  <ClearMatchButton unitId={u.id} listing={u.airbnb_listing_name!} />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </>
  );
}
