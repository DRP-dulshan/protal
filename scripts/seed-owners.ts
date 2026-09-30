/**
 * One-time move of the owners from the old WordPress owner portal.
 *
 * Reads a CSV of full_name,email,phone and, for each row, creates (or reuses)
 * the owner record, a portal login for that email (role owner, no password
 * yet) and the link between them. Nothing is emailed unless asked:
 *
 *   npm run owners:seed -- owners.csv                    dry run - reads only, prints the plan
 *   npm run owners:seed -- owners.csv --apply            creates owners and logins, sends nothing
 *   npm run owners:seed -- owners.csv --send-email       emails each owner a "Set my password" link
 *        [--link-valid-hours 24]                         what the email says the link lasts
 *
 * Safe to run again: owners are matched by email and reused, and an existing
 * login is linked rather than duplicated. A row whose email belongs to a
 * D|R|P staff account is skipped, so a staff login never becomes an owner.
 *
 * --send-email needs EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM (a
 * sender on a domain verified in Resend). Supabase's own mailer cannot be
 * used: it only delivers to the project's team. --link-valid-hours must match
 * Supabase -> Authentication -> Sign In / Providers -> Email -> "Email OTP
 * Expiration" (3600 seconds = 1 hour by default, at most 86400 = 24 hours).
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and OWNER_URL in
 * .env.local, pointing at the production project.
 */
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// Loaded after .env.local: these read the environment when first imported.
const { createClient } = await import("@supabase/supabase-js");
const { env } = await import("@/lib/env");
const { isStaff } = await import("@/lib/auth/rbac");
const { parseCsv } = await import("@/lib/airbnb/earnings-csv");
const { buildPortalInvite } = await import("@/lib/notify/invite-email");
const { sendMessage } = await import("@/lib/messaging");

type Role = import("@/lib/auth/rbac").Role;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const apply = args.includes("--apply");
const sendEmail = args.includes("--send-email");
const hoursArg = args[args.indexOf("--link-valid-hours") + 1];
const linkValidHours = args.includes("--link-valid-hours") ? Number(hoursArg) : 1;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!file) fail("Usage: npm run owners:seed -- owners.csv [--apply] [--send-email] [--link-valid-hours 24]");
if (apply && sendEmail) fail("Run --apply first, check the result, then --send-email as a separate step.");
if (!Number.isInteger(linkValidHours) || linkValidHours < 1 || linkValidHours > 24) {
  fail("--link-valid-hours must be a whole number from 1 to 24.");
}
if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
  fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set in .env.local.");
}
if (!/^https:\/\//.test(env.ownerUrl)) {
  fail(`OWNER_URL is ${env.ownerUrl}. Set it to https://owner.dubairapidproperties.com in .env.local.`);
}
if (sendEmail && (env.messaging.emailProvider !== "resend" || !env.messaging.resendApiKey)) {
  fail("Email is not set up: EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM are needed in .env.local.");
}

// ---------------------------------------------------------------- the file
interface Row {
  line: number;
  fullName: string;
  email: string;
  phone: string | null;
}

const csv = parseCsv(readFileSync(file, "utf8"));
const header = csv[0]?.map((h) => h.trim().toLowerCase()) ?? [];
const col = (name: string) => header.indexOf(name);
if (col("full_name") < 0 || col("email") < 0) fail("The file needs full_name and email columns.");

const problems: string[] = [];
const seen = new Set<string>();
const rows: Row[] = csv.slice(1).map((r, i) => {
  const line = i + 2;
  const fullName = (r[col("full_name")] ?? "").trim().replace(/\s+/g, " ");
  const email = (r[col("email")] ?? "").trim().toLowerCase();
  const phone = col("phone") >= 0 ? (r[col("phone")] ?? "").trim() || null : null;
  if (!fullName) problems.push(`Line ${line} (${email || "no email"}): the name is empty.`);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push(`Line ${line}: "${email}" is not an email address.`);
  if (seen.has(email)) problems.push(`Line ${line}: ${email} appears twice.`);
  seen.add(email);
  return { line, fullName, email, phone };
});
if (problems.length) fail(`Fix the file first - nothing was changed:\n  ${problems.join("\n  ")}`);

// ---------------------------------------------------------- what exists
const db = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [ownersResult, profilesResult, companyResult] = await Promise.all([
  db.from("owners").select("id, full_name, email"),
  db.from("profiles").select("id, email, role").in("email", rows.map((r) => r.email)),
  db.from("company_settings").select("trade_name, legal_name, registered_address, phone, email").maybeSingle(),
]);
if (ownersResult.error) fail(`Could not read owners: ${ownersResult.error.message}`);
if (profilesResult.error) fail(`Could not read logins: ${profilesResult.error.message}`);

const ownerByEmail = new Map(
  (ownersResult.data ?? []).filter((o) => o.email).map((o) => [o.email!.trim().toLowerCase(), o])
);
const profileByEmail = new Map(
  (profilesResult.data ?? []).map((p) => [(p.email ?? "").toLowerCase(), p as { id: string; role: Role }])
);

// ------------------------------------------------------------- the plan
type Plan = { row: Row; skip?: string; ownerId?: string; profileId?: string };
const plans: Plan[] = rows.map((row) => {
  const profile = profileByEmail.get(row.email);
  if (profile && isStaff(profile.role)) return { row, skip: "email belongs to a D|R|P staff login" };
  return { row, ownerId: ownerByEmail.get(row.email)?.id, profileId: profile?.id };
});

const mode = apply ? "APPLY" : sendEmail ? "SEND EMAIL" : "DRY RUN (nothing is changed)";
console.log(`\n${mode} - ${env.supabaseUrl}\n`);
for (const p of plans) {
  const what = p.skip
    ? `SKIP: ${p.skip}`
    : sendEmail
      ? p.profileId
        ? `email a ${linkValidHours}h "Set my password" link`
        : "SKIP: no login yet - run --apply first"
      : [p.ownerId ? "owner exists (reused)" : "new owner", p.profileId ? "login exists (linked)" : "new login"].join(", ");
  console.log(`  ${p.row.fullName.padEnd(24)} ${p.row.email.padEnd(34)} ${what}`);
}

if (!apply && !sendEmail) {
  console.log("\nDry run only. Add --apply to create the owners and logins.\n");
  process.exit(0);
}

// ---------------------------------------------------------------- apply
async function applyRow(p: Plan): Promise<string> {
  const { row } = p;

  let ownerId = p.ownerId;
  if (!ownerId) {
    const { data, error } = await db
      .from("owners")
      .insert({ full_name: row.fullName, email: row.email, phone: row.phone, preferred_channel: "email" })
      .select("id")
      .single();
    if (error) throw new Error(`owner: ${error.message}`);
    ownerId = data.id;
  }

  let profileId = p.profileId;
  if (!profileId) {
    // No password: nobody can sign in with this login until the owner sets
    // one through the emailed link. The address is the one the owner already
    // used on the WordPress portal, so it is created confirmed.
    const { data, error } = await db.auth.admin.createUser({
      email: row.email,
      email_confirm: true,
      user_metadata: { full_name: row.fullName },
    });
    if (error || !data.user) throw new Error(`login: ${error?.message ?? "not created"}`);
    profileId = data.user.id;
  }

  const { error: profileError } = await db
    .from("profiles")
    .upsert(
      { id: profileId, email: row.email, full_name: row.fullName, phone: row.phone, role: "owner", is_active: true },
      { onConflict: "id" }
    );
  if (profileError) throw new Error(`owner role: ${profileError.message}`);

  const { error: linkError } = await db
    .from("owner_users")
    .upsert({ owner_id: ownerId, profile_id: profileId }, { onConflict: "owner_id,profile_id", ignoreDuplicates: true });
  if (linkError) throw new Error(`link: ${linkError.message}`);

  return "done";
}

async function emailRow(p: Plan): Promise<string> {
  const { row } = p;
  // A recovery link signs the owner in once - into the portal, or to "set
  // your password" when OWNER_PASSWORDS=on - exactly like Give portal access.
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email: row.email });
  if (error || !data.properties) throw new Error(`link: ${error?.message ?? "not created"}`);
  const link = `${env.ownerUrl}/auth/confirm?${new URLSearchParams({
    token_hash: data.properties.hashed_token,
    type: "recovery",
  })}`;

  const invite = buildPortalInvite({
    ownerName: row.fullName,
    email: row.email,
    link,
    portalUrl: env.ownerUrl,
    company: companyResult.data,
    linkValidHours,
    mode: env.ownerPasswords ? "password" : "link",
  });
  const result = await sendMessage({
    channel: "email",
    to: row.email,
    subject: invite.subject,
    body: invite.text,
    html: invite.html,
  });
  if (!result.ok || result.skipped) throw new Error(`email: ${result.error ?? "not sent"}`);
  // Resend's free plan allows 2 emails a second.
  await new Promise((resolve) => setTimeout(resolve, 600));
  return "emailed";
}

console.log("");
let failed = 0;
for (const p of plans) {
  if (p.skip || (sendEmail && !p.profileId)) continue;
  try {
    const outcome = apply ? await applyRow(p) : await emailRow(p);
    console.log(`  ok    ${p.row.email} - ${outcome}`);
  } catch (error) {
    failed++;
    console.log(`  FAIL  ${p.row.email} - ${(error as Error).message}`);
  }
}
console.log(failed ? `\n${failed} failed. Fix them and run the same command again.\n` : "\nAll done.\n");
process.exit(failed ? 1 : 0);
