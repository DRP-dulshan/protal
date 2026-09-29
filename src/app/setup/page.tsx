import { CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Logo } from "@/components/layout/logo";
import { env, isConfigured } from "@/lib/env";

export const metadata = { title: "Setup" };

/**
 * Shown when the app has no Supabase credentials. Rather than failing with a
 * stack trace, it states exactly what is missing and how to supply it.
 */
export default function SetupPage() {
  const checks = [
    {
      label: "NEXT_PUBLIC_SUPABASE_URL",
      done: Boolean(env.supabaseUrl),
      hint: "Project URL from Supabase → Project Settings → API",
    },
    {
      label: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      done: Boolean(env.supabaseAnonKey),
      hint: "Publishable key (or the legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    },
    {
      label: "SUPABASE_SECRET_KEY",
      done: Boolean(env.supabaseServiceRoleKey),
      hint: "Or the legacy SUPABASE_SERVICE_ROLE_KEY. Needed only for scheduled jobs",
    },
  ];

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center p-6">
      <div className="mb-6 flex items-center gap-3">
        <Logo className="shrink-0" imageClassName="w-24" priority />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Property Management setup</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            {isConfigured ? "Configuration detected" : "Configuration required"}
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          <section>
            <h2 className="mb-3 font-medium">1. Environment</h2>
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              Copy <code className="rounded bg-[var(--muted)] px-1">.env.example</code>{" "}
              to <code className="rounded bg-[var(--muted)] px-1">.env.local</code> and
              fill in the values below. Both the new{" "}
              <code className="rounded bg-[var(--muted)] px-1">sb_publishable_…</code> /{" "}
              <code className="rounded bg-[var(--muted)] px-1">sb_secret_…</code> keys and
              the legacy anon / service_role pair are accepted.
            </p>
            <ul className="space-y-2">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2 text-sm">
                  {check.done ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                  ) : (
                    <Circle className="mt-0.5 size-4 shrink-0 text-[var(--muted-foreground)]" />
                  )}
                  <span className="min-w-0">
                    <code className="text-xs">{check.label}</code>
                    <span className="block text-xs text-[var(--muted-foreground)]">
                      {check.hint}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="mb-2 font-medium">2. Database</h2>
            <p className="mb-2 text-sm text-[var(--muted-foreground)]">
              Apply the migrations in order against your Supabase project&apos;s SQL
              editor, or with the Supabase CLI:
            </p>
            <pre className="overflow-x-auto rounded-md bg-[var(--muted)] p-3 text-xs">
              supabase db push
            </pre>
            <p className="mt-2 text-xs text-[var(--muted-foreground)]">
              No CLI? Paste <code>supabase/ALL_MIGRATIONS.sql</code> into the SQL
              Editor — it is every migration concatenated, and applies in one run.
              Do not run <code>supabase/local/00_shim.sql</code> against a real
              project: those objects already exist there.
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-medium">3. First user</h2>
            <p className="text-sm text-[var(--muted-foreground)]">
              Create a user in Supabase → Authentication → Users, then set their role:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-[var(--muted)] p-3 text-xs">
              {`update profiles set role = 'super_admin'
where email = 'you@drp.ae';`}
            </pre>
          </section>
        </CardContent>
      </Card>
    </main>
  );
}
