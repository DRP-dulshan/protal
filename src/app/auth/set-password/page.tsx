import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/layout/logo";
import { getProfile } from "@/lib/auth/session";
import { setPassword } from "../actions";

export const metadata = { title: "Choose a password" };

const ERRORS: Record<string, string> = {
  short: "Use at least 8 characters.",
  mismatch: "The two passwords do not match.",
  same: "Choose a password different from your current one.",
  failed: "The password could not be saved. Please try again.",
};

/** Reached from a sign-in link once it has been confirmed. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await getProfile();
  if (!profile) redirect("/login?error=link_invalid");

  const { error: code } = await searchParams;
  const error = code ? (ERRORS[code] ?? ERRORS.failed) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6">
          <Logo variant="white" className="rounded-xl px-10 py-8" imageClassName="w-48" priority />
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={setPassword} className="space-y-4">
              <div>
                <h1 className="text-lg font-semibold">Choose your password</h1>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  You will sign in as {profile.email}.
                </p>
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="password">New password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm">Repeat the password</Label>
                <Input
                  id="confirm"
                  name="confirm"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </div>

              <Button type="submit" className="w-full">
                Save and continue
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
