import { requireCapability } from "@/lib/auth/session";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/domain/shared";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import Airbnb earnings" };

export default async function ImportAirbnbEarningsPage() {
  await requireCapability("bookings.manage");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Bookings", href: "/bookings" }]}
        title="Import Airbnb earnings"
        description="Prices every Airbnb stay in the file at once, matched by confirmation code."
      />

      <Card className="mb-5">
        <CardContent className="space-y-2 p-5 text-sm">
          <p className="font-medium">Getting the file from Airbnb</p>
          <ol className="list-decimal space-y-1 pl-5 text-[var(--muted-foreground)]">
            <li>In Airbnb, open Menu, then Earnings.</li>
            <li>Choose Transaction history (upcoming or paid), set the dates, and click Export CSV.</li>
            <li>Upload that file here. Importing the same file again is safe.</li>
          </ol>
          <p className="text-[var(--muted-foreground)]">
            Each reservation&apos;s payout, Airbnb service fee, cleaning fee and Tourism Dirham
            are filled in, and the guest&apos;s name is added where the booking has none. Owners
            never see these amounts.
          </p>
        </CardContent>
      </Card>

      <ImportForm />
    </>
  );
}
