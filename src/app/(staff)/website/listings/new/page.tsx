import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { dubaiToday } from "@/lib/calendar";
import { ListingForm } from "../listing-form";
import { listingFormOptions } from "../form-data";

export const metadata = { title: "New listing" };

export default async function NewListingPage() {
  const [, options] = await Promise.all([requireCapability("website.manage"), listingFormOptions()]);
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Website listings", href: "/website/listings" }]}
        title="New listing"
        description="A sale or rental listing for the D|R|P website. It stays a draft until you put it on the website."
      />
      <ListingForm {...options} today={dubaiToday()} />
    </>
  );
}
