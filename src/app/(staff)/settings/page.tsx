import { requireCapability, getCompanySettings } from "@/lib/auth/session";
import { PageHeader } from "@/components/domain/shared";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Company settings" };

export default async function SettingsPage() {
  await requireCapability("settings.manage");
  const settings = await getCompanySettings();

  return (
    <>
      <PageHeader
        title="Company settings"
        description="Regulatory identifiers, VAT, default fees and the notice periods the system enforces."
      />
      {settings ? (
        <SettingsForm settings={settings} />
      ) : (
        <p className="text-sm text-[var(--muted-foreground)]">
          Company settings row not found. Apply the migrations in
          supabase/migrations before using this screen.
        </p>
      )}
    </>
  );
}
