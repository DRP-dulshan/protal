/**
 * Copies all data from one Supabase project into another that already has
 * the schema (npm run db:migrate): auth users with their original ids and
 * password hashes, every public table, sequence positions, storage bucket
 * settings and storage files. Then compares row counts table by table.
 *
 *   node scripts/copy-supabase-project.mjs --from .env.sydney.backup --to .env.local
 *   node scripts/copy-supabase-project.mjs --from ... --to ... --verify   # counts only
 *
 * Safety:
 * - The source is only ever read, inside BEGIN READ ONLY transactions, which
 *   the script confirms before reading. Storage files are downloaded, never
 *   modified.
 * - All database writes to the target happen in ONE transaction: it copies
 *   everything or nothing. It refuses to run if the target already has users
 *   or units, so it cannot overwrite real data.
 * - Triggers are suspended on the target for the copy
 *   (session_replication_role = replica). The rows are copied as they are,
 *   so the booking triggers must not add blocks and cleaning tasks, the
 *   new-user trigger must not add profiles, and the audit trigger must not
 *   log the import.
 *
 * Signed-in sessions do not carry over: the new project signs tokens with a
 * different key, so everyone signs in again with their existing password.
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const verifyOnly = args.includes("--verify");

function readEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
  const key = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  if (!env.DATABASE_URL || !env.NEXT_PUBLIC_SUPABASE_URL || !key) {
    throw new Error(`${file} needs DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and a secret key`);
  }
  return { db: env.DATABASE_URL, url: env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/$/, ""), key };
}

const fromFile = option("--from");
const toFile = option("--to");
if (!fromFile || !toFile) {
  console.error("Usage: node scripts/copy-supabase-project.mjs --from <env file> --to <env file> [--verify]");
  process.exit(1);
}
const source = readEnv(fromFile);
const target = readEnv(toFile);
if (source.url === target.url) throw new Error("Source and target are the same project.");

const connect = (db) =>
  postgres(db, { max: 1, ssl: /localhost|127\.0\.0\.1/.test(db) ? false : "require", onnotice: () => {} });
const src = connect(source.db);
const tgt = connect(target.db);

/** Every read of the source goes through here. */
async function readSource(fn) {
  return src.begin("read only", async (tx) => {
    const [{ ro }] = await tx`select current_setting('transaction_read_only') as ro`;
    if (ro !== "on") throw new Error("Refusing to read the source outside a read-only transaction.");
    return fn(tx);
  });
}

const AUTH_TABLES = ["auth.users", "auth.identities"];

async function publicTables(sql) {
  const rows = await sql`
    select c.relname as name
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by 1`;
  return rows.map((r) => `public.${r.name}`);
}

/** Writable columns (not generated) of a table. */
async function columns(sql, qualified) {
  const [schema, table] = qualified.split(".");
  const rows = await sql`
    select a.attname as name
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = ${schema} and c.relname = ${table}
      and a.attnum > 0 and not a.attisdropped and a.attgenerated = '' and a.attidentity <> 'a'
    order by a.attnum`;
  return rows.map((r) => r.name);
}

/**
 * Row counts, plus a checksum of every row over the columns both projects
 * share, so equal counts with different contents cannot pass. Storage bucket
 * timestamps are left out: Supabase rewrites them itself.
 */
async function compare(tables) {
  const allCols = async (sql, qualified) => {
    const [schema, table] = qualified.split(".");
    const rows = await sql`
      select a.attname as name from pg_attribute a
      join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${schema} and c.relname = ${table} and a.attnum > 0 and not a.attisdropped
      order by a.attnum`;
    return rows.map((r) => r.name);
  };
  const digest = async (sql, qualified, shared) => {
    const [schema, table] = qualified.split(".");
    const [row] = await sql`
      select count(*)::bigint as n,
             md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h
      from (select jsonb_build_array(${sql(shared)}) as x from ${sql(schema)}.${sql(table)}) z`;
    return { n: Number(row.n), h: row.h };
  };

  const results = [];
  await readSource(async (tx) => {
    for (const t of tables) {
      const srcCols = new Set(await allCols(tx, t));
      let shared = (await allCols(tgt, t)).filter((c) => srcCols.has(c));
      if (t.startsWith("storage.")) shared = shared.filter((c) => c !== "created_at" && c !== "updated_at");
      if (shared.length === 0) {
        results.push({ t, a: null, b: null, same: true });
        continue;
      }
      const a = await digest(tx, t, shared);
      const b = await digest(tgt, t, shared);
      results.push({ t, a: a.n, b: b.n, same: a.h === b.h });
    }
  });

  const bad = results.filter((r) => !r.same);
  console.log(`\n${"table".padEnd(40)} ${"source".padStart(8)} ${"target".padStart(8)}  contents`);
  for (const r of results) {
    console.log(`${r.t.padEnd(40)} ${String(r.a ?? "n/a").padStart(8)} ${String(r.b ?? "n/a").padStart(8)}  ${r.same ? "identical" : "DIFFERENT"}`);
  }
  console.log(bad.length ? `\n${bad.length} table(s) differ.` : `\nAll ${results.length} tables identical: same row counts and same row contents.`);
  return bad.length;
}

async function copyStorageFiles(objects) {
  let copied = 0;
  for (const o of objects) {
    const path = `${o.bucket_id}/${o.name.split("/").map(encodeURIComponent).join("/")}`;
    const res = await fetch(`${source.url}/storage/v1/object/${path}`, {
      headers: { Authorization: `Bearer ${source.key}`, apikey: source.key },
    });
    if (!res.ok) throw new Error(`Download failed for ${o.bucket_id}/${o.name}: HTTP ${res.status}`);
    const body = Buffer.from(await res.arrayBuffer());
    const up = await fetch(`${target.url}/storage/v1/object/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${target.key}`,
        apikey: target.key,
        "Content-Type": o.mimetype || "application/octet-stream",
        "x-upsert": "true",
      },
      body,
    });
    if (!up.ok) throw new Error(`Upload failed for ${o.bucket_id}/${o.name}: HTTP ${up.status} ${await up.text()}`);
    copied++;
  }
  return copied;
}

try {
  const tables = await publicTables(tgt);
  const everything = [...AUTH_TABLES, ...tables, "storage.buckets", "storage.objects"];

  if (verifyOnly) {
    process.exitCode = (await compare(everything)) ? 1 : 0;
  } else {
    const [{ users }] = await tgt`select count(*)::int as users from auth.users`;
    const [{ units }] = await tgt`select count(*)::int as units from public.units`;
    if (users > 0 || units > 0) {
      throw new Error(`The target already has ${users} users and ${units} units; refusing to overwrite it.`);
    }

    // 1. Snapshot the source: rows as JSON, sequence positions, storage.
    const sourceTables = new Set(await readSource((tx) => publicTables(tx)));
    const missingInSource = tables.filter((t) => !sourceTables.has(t));
    const extraInSource = [...sourceTables].filter((t) => !tables.includes(t));
    if (extraInSource.length) throw new Error(`Source has tables the target lacks: ${extraInSource.join(", ")}`);

    const snapshot = await readSource(async (tx) => {
      const data = {};
      for (const t of [...AUTH_TABLES, ...tables.filter((x) => sourceTables.has(x))]) {
        const cols = await columns(tx, t);
        const [schema, table] = t.split(".");
        // Carried as JSON text, never parsed in JavaScript: parsing would
        // turn 1000.00 into 1000 inside jsonb columns and round integers
        // beyond 2^53.
        const [{ rows, n }] = await tx`
          select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb)::text as rows, count(*)::int as n
          from ${tx(schema)}.${tx(table)} x`;
        data[t] = { cols, rows, n };
      }
      const sequences = await tx`
        select schemaname as schema, sequencename as name, last_value
        from pg_sequences
        where schemaname in ('public', 'pms') and last_value is not null`;
      const buckets = await tx`select id, name, public, file_size_limit, allowed_mime_types from storage.buckets`;
      const objects = await tx`
        select bucket_id, name, metadata->>'mimetype' as mimetype from storage.objects order by bucket_id, name`;
      return { data, sequences, buckets, objects };
    });

    // 2. Write the target in one transaction.
    await tgt.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;

      // Remove the rows the migrations seeded (settings, GL categories, one
      // audit entry); the source's own copies replace them.
      await tx.unsafe(`truncate table ${tables.join(", ")} restart identity cascade`);

      for (const [t, { cols, rows, n }] of Object.entries(snapshot.data)) {
        if (n === 0) continue;
        const targetCols = new Set(await columns(tx, t));
        const shared = cols.filter((c) => targetCols.has(c));
        const [schema, table] = t.split(".");
        await tx`
          insert into ${tx(schema)}.${tx(table)} (${tx(shared)})
          select ${tx(shared)} from jsonb_populate_recordset(null::${tx(schema)}.${tx(table)}, ${rows}::text::jsonb)`;
        process.stdout.write(`  ${t}: ${n}\n`);
      }

      for (const s of snapshot.sequences) {
        await tx`select setval(${`${s.schema}.${s.name}`}::regclass, ${s.last_value}::bigint, true)`;
      }

      for (const b of snapshot.buckets) {
        await tx`
          insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
          values (${b.id}, ${b.name}, ${b.public}, ${b.file_size_limit}, ${b.allowed_mime_types})
          on conflict (id) do update set public = excluded.public,
            file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types`;
      }
    });
    console.log(`Database copy committed. Sequences aligned: ${snapshot.sequences.length}.`);
    if (missingInSource.length) console.log(`Tables new in the target (left empty): ${missingInSource.join(", ")}`);

    // 3. Files live in object storage, not in the database.
    const copied = await copyStorageFiles(snapshot.objects);
    console.log(`Storage files copied: ${copied}.`);

    process.exitCode = (await compare(everything)) ? 1 : 0;
  }
} catch (error) {
  console.error(`\nFailed: ${error.message}`);
  console.error("The target database transaction was rolled back; the source was only read.");
  process.exitCode = 1;
} finally {
  await src.end();
  await tgt.end();
}
