/**
 * Installs or updates the Supabase database from this machine, without pasting
 * anything into the SQL Editor.
 *
 *   npm run db:setup            # fresh database: full schema; existing: pending migrations
 *   npm run db:setup -- --seed  # ... plus the demo portfolio in supabase/seed.sql
 *   npm run db:migrate          # same as db:setup; the name to reach for after a git pull
 *
 * Reads DATABASE_URL from .env.local (Supabase -> Connect -> Session pooler).
 *
 * Applied migrations are recorded in pms.schema_migrations, so each one runs
 * exactly once. Every file runs in its own transaction together with its
 * bookkeeping row: a failure leaves the database exactly as it was before
 * that file.
 */
import { readdirSync } from "node:fs";
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const url = process.argv.find((a) => a.startsWith("postgres")) ?? process.env.DATABASE_URL;
if (!url || url.includes("<")) {
  console.error(
    "DATABASE_URL is not set in .env.local.\n" +
      "Copy it from Supabase -> Connect -> Session pooler, with your database password filled in."
  );
  process.exit(1);
}

const DIR = "supabase/migrations";
const seed = process.argv.includes("--seed");
const local = /localhost|127\.0\.0\.1/.test(url);
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: local ? false : "require" });

const migrations = readdirSync(DIR).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();

/**
 * Databases installed before migrations were tracked. Each probe checks for
 * something the migration creates; the baseline is the longest run of
 * migrations whose probe passes. 0001-0012 have no probe of their own: if
 * company_settings exists, ALL_MIGRATIONS.sql ran and they are all present.
 */
const PROBES = {
  "0013_current_profile.sql": sql`select to_regprocedure('public.current_profile()') is not null as ok`,
  "0014_owner_financial_isolation.sql": sql`select to_regclass('public.owner_units_view') is not null as ok`,
  "0015_company_details.sql": sql`
    select coalesce(column_default like '%DRP Real Estate Brokers LLC%', false) as ok
    from information_schema.columns
    where table_schema = 'public' and table_name = 'company_settings' and column_name = 'legal_name'`,
};

async function record(tx, files) {
  for (const f of files) {
    await tx`insert into pms.schema_migrations (filename) values (${f}) on conflict do nothing`;
  }
}

async function apply(file) {
  process.stdout.write(`Applying ${file} ... `);
  await sql.begin(async (tx) => {
    await tx.file(`${DIR}/${file}`);
    await record(tx, [file]);
  });
  console.log("done");
}

try {
  const [{ installed }] = await sql`select to_regclass('public.company_settings') is not null as installed`;

  if (!installed) {
    process.stdout.write("Fresh database: applying supabase/ALL_MIGRATIONS.sql ... ");
    await sql.begin(async (tx) => {
      await tx.file("supabase/ALL_MIGRATIONS.sql");
      await tx`create table if not exists pms.schema_migrations (
        filename text primary key, applied_at timestamptz not null default now())`;
      await record(tx, migrations);
    });
    console.log(`done (${migrations.length} migrations)`);
  } else {
    await sql`create table if not exists pms.schema_migrations (
      filename text primary key, applied_at timestamptz not null default now())`;

    const done = new Set((await sql`select filename from pms.schema_migrations`).map((r) => r.filename));

    if (done.size === 0) {
      // Installed before tracking existed: work out how far it got.
      const baseline = [];
      for (const f of migrations) {
        const probe = PROBES[f];
        if (probe) {
          const [row] = await probe;
          if (!row?.ok) break;
        } else if (Number(f.slice(0, 4)) > 12) {
          break;
        }
        baseline.push(f);
      }
      await sql.begin((tx) => record(tx, baseline));
      baseline.forEach((f) => done.add(f));
      console.log(`Existing database: recorded ${baseline.length} migrations already installed.`);
    }

    const pending = migrations.filter((f) => !done.has(f));
    if (pending.length === 0) console.log("Schema is up to date.");
    for (const f of pending) await apply(f);
  }

  if (seed) {
    const [{ n }] = await sql`select count(*)::int as n from properties`;
    if (n > 0) console.log("Demo data skipped: the database already has properties.");
    else {
      process.stdout.write("Applying supabase/seed.sql ... ");
      await sql.begin((tx) => tx.file("supabase/seed.sql"));
      console.log("done");
    }
  }

  console.log("\nDatabase ready.");
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  console.error("Nothing from the failing file was applied.");
  process.exitCode = 1;
} finally {
  await sql.end();
}
