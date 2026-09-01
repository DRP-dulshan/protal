import { requireCapability } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { PageHeader } from "@/components/domain/shared";
import { OwnerForm } from "./owner-form";

export const metadata = { title: "Add owner" };

export default async function NewOwnerPage() {
  const profile = await requireCapability("owners.manage");

  return (
    <>
      <PageHeader
        breadcrumb={[{ label: "Owners", href: "/owners" }]}
        title="Add owner"
        description="An individual or company whose property D|R|P manages."
      />
      <OwnerForm canEnterBankDetails={can(profile.role, "owners.bank_details")} />
    </>
  );
}
