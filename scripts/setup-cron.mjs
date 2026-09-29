/**
 * Schedules the Airbnb calendar import in Supabase: pg_cron calls
 * <admin-url>/api/cron/ical-sync every 15 minutes through pg_net. Vercel's
 * Hobby plan only runs crons daily, so the schedule lives in the database.
 *
 *   npm run db:cron -- --url https://admin.dubairapidproperties.com
 *   npm run db:cron -- --status      # last runs and responses
 *   npm run db:cron -- --remove      # stop the schedule
 *
 * Needs DATABASE_URL and CRON_SECRET in .env.local. The same CRON_SECRET
 * must be set in the Vercel project's environment variables. The secret is
 * stored in Supabase Vault and read at call time, so it never appears in the
 * job definition (cron.job is readable in the dashboard).
 */
import postgres from "postgres";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

const JOB = "drp-ical-sync";
const SECRET_NAME = "drp_cron_secret";
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const dbUrl = option("--db") ?? process.env.DATABASE_URL;
if (!dbUrl || dbUrl.includes("<")) {
  console.error("DATABASE_URL is not set in .env.local (Supabase -> Connect -> Session pooler).");
  process.exit(1);
}
const local = /localhost|127\.0\.0\.1/.test(dbUrl);
const sql = postgres(dbUrl, { max: 1, onnotice: () => {}, ssl: local ? false : "require" });

async function status() {
  const jobs = await sql`select jobid, schedule, active from cron.job where jobname = ${JOB}`;
  if (jobs.length === 0) {
    console.log("No schedule installed.");
    return;
  }
  console.log(`Schedule: ${jobs[0].schedule} (${jobs[0].active ? "active" : "paused"})`);
  const runs = await sql`
    select start_time, status, return_message
    from cron.job_run_details where jobid = ${jobs[0].jobid}
    order by start_time desc limit 5`;
  for (const r of runs) console.log(`  run ${r.start_time.toISOString()}  ${r.status}  ${r.return_message ?? ""}`);
  const responses = await sql`
    select created, status_code, left(coalesce(content, error_msg, ''), 160) as body
    from net._http_response order by created desc limit 5`.catch(() => []);
  for (const r of responses) console.log(`  http ${r.created.toISOString()}  ${r.status_code ?? "-"}  ${r.body}`);
}

try {
  if (flag("--status")) {
    await status();
  } else if (flag("--remove")) {
    await sql`select cron.unschedule(jobid) from cron.job where jobname = ${JOB}`;
    console.log("Schedule removed.");
  } else {
    const appUrl = option("--url");
    const secret = process.env.CRON_SECRET;
    if (!appUrl || !/^https:\/\/[^/]+$/.test(appUrl.replace(/\/$/, ""))) {
      console.error("Pass the admin portal's public URL: --url https://admin.dubairapidproperties.com");
      process.exit(1);
    }
    if (!secret || secret.length < 32) {
      console.error(
        "CRON_SECRET is missing or shorter than 32 characters in .env.local.\n" +
          "Generate one with:  openssl rand -hex 32\n" +
          "and set the same value in Vercel -> Settings -> Environment Variables."
      );
      process.exit(1);
    }
    const endpoint = `${appUrl.replace(/\/$/, "")}/api/cron/ical-sync`;

    await sql.begin(async (tx) => {
      // Skipped when already enabled from the dashboard (the schemas exist).
      await tx`do $$ begin
        if to_regnamespace('cron') is null then create extension pg_cron; end if;
        if to_regnamespace('net') is null then create extension pg_net; end if;
      end $$`;

      const [existing] = await tx`select id from vault.secrets where name = ${SECRET_NAME}`;
      if (existing) await tx`select vault.update_secret(${existing.id}, ${secret})`;
      else await tx`select vault.create_secret(${secret}, ${SECRET_NAME}, 'Bearer token for the DRP /api/cron endpoints')`;

      await tx`select cron.unschedule(jobid) from cron.job where jobname = ${JOB}`;
      // The URL is quoted into the job's command server-side with format(%L).
      await tx`
        select cron.schedule(${JOB}, '*/15 * * * *', format($cmd$
          select net.http_post(
            url := %L,
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = %L)
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 55000
          )
        $cmd$, ${endpoint}::text, ${SECRET_NAME}::text))`;
    });

    console.log(`Scheduled: every 15 minutes -> ${endpoint}`);
    console.log("Check it with:  npm run db:cron -- --status");
  }
} catch (error) {
  console.error(`Failed: ${error.message}`);
  if (/extension "pg_(cron|net)"/.test(error.message)) {
    console.error("Enable pg_cron and pg_net in Supabase -> Database -> Extensions, then run this again.");
  }
  process.exitCode = 1;
} finally {
  await sql.end();
}
