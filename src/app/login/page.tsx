import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { isConfigured } from "@/lib/env";
import { getProfile } from "@/lib/auth/session";
import { homePathForRole } from "@/lib/auth/rbac";
import { signIn } from "./actions";

export const metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  invalid: "That email and password combination was not recognised.",
  account_disabled:
    "This account has been deactivated. Contact your administrator.",
  missing: "Enter both your email address and password.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  if (!isConfigured) redirect("/setup");

  const profile = await getProfile();
  if (profile) redirect(homePathForRole(profile.role));

  const error = params.error ? (ERRORS[params.error] ?? ERRORS.invalid) : null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[var(--muted)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex size-12 items-center justify-center rounded-xl bg-[var(--primary)]">
            <Building2 className="size-6 text-[var(--primary-foreground)]" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">
            D<span className="text-[var(--brand)]">|</span>R
            <span className="text-[var(--brand)]">|</span>P
          </h1>
          <p className="mt-1 text-sm text-[var(--muted-foreground)]">
            Property Management System
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={signIn} className="space-y-4">
              <input type="hidden" name="next" value={params.next ?? ""} />

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-[var(--destructive)]/40 bg-[var(--destructive)]/10 p-3 text-sm"
                >
                  {error}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="email">Email address</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  placeholder="you@drp.ae"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full">
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>

        <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">
          Owners and tenants: use the credentials issued by your property
          manager.{" "}
          <Link href="/setup" className="underline underline-offset-2">
            Setup guide
          </Link>
        </p>
      </div>
    </main>
  );
}
