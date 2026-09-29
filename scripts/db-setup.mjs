/**
 * Sets up a fresh Supabase database from this machine, without pasting
 * anything into the SQL Editor: applies supabase/ALL_MIGRATIONS.sql and, with
 * --seed, the demo portfolio in supabase/seed.sql.
 *
 * Reads DATABASE_URL from .env.local (Supabase -> Connect -> Session pooler).
 *
 *   npm run db:setup            # schema only
 *   npm run db:setup -- --seed  # schema + demo data
 *
 * Each file runs as a single transaction, so a failure leaves the database
 * exactly as it was.
 */
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

const seed = process.argv.includes("--seed");
const sql = postgres(url, { max: 1, onnotice: () => {}, ssl: url.includes("localhost") ? false : "require" });

async function run(file) {
  process.stdout.write(`Applying ${file} ... `);
  await sql.begin((tx) => tx.file(file));
  console.log("done");
}

try {
  const [{ exists }] = await sql`select to_regclass('public.company_settings') is not null as exists`;
  if (exists) {
    console.log("The schema is already installed; skipping supabase/ALL_MIGRATIONS.sql.");
  } else {
    await run("supabase/ALL_MIGRATIONS.sql");
  }

  if (seed) {
    const [{ n }] = await sql`select count(*)::int as n from properties`;
    if (n > 0) console.log("Demo data skipped: the database already has properties.");
    else await run("supabase/seed.sql");
  }

  console.log("\nDatabase ready. Next: create your user in Supabase -> Authentication -> Users.");
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  console.error("Nothing from the failing file was applied.");
  process.exitCode = 1;
} finally {
  await sql.end();
}
