import { requireCapability } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { ImportListingsForm } from "./import-form";

export const metadata = { title: "Import website listings" };

/** The website's current data file, in its public GitHub repository. */
const WEBSITE_FILE = "https://raw.githubusercontent.com/DRP-dulshan/new-home/main/data/imported/listings.json";

export default async function ImportListingsPage() {
  await requireCapability("website.manage");
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Website listings", href: "/website/listings" }]}
        title="Import website listings"
        description="Brings the listings the website shows today into the portal, so they can be edited here from now on."
      />
      <ImportListingsForm defaultUrl={WEBSITE_FILE} />
    </>
  );
}
