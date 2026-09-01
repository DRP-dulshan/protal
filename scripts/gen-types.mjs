/**
 * Generates src/lib/db/database.types.ts from a live PostgreSQL schema.
 *
 * Point it at the local validation database (supabase/local/rebuild.sh) or at
 * the real Supabase project. Deriving the types from the database rather than
 * hand-maintaining them means the SQL migrations stay the single source of
 * truth and the two can never silently drift.
 *
 *   node scripts/gen-types.mjs "postgresql://postgres@localhost:55432/drp_test"
 */
import postgres from "postgres";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const url = process.argv[2] ?? process.env.DATABASE_URL;
if (!url) {
  console.error("Usage: node scripts/gen-types.mjs <postgres-url>");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });
const OUT = "src/lib/db/database.types.ts";

const scalar = (udt) => {
  if (/^(int2|int4|int8|numeric|float4|float8|money)$/.test(udt)) return "number";
  if (udt === "bool") return "boolean";
  if (udt === "json" || udt === "jsonb") return "Json";
  return "string"; // uuid, text, varchar, bpchar, date, timestamptz, time, inet, bytea
};

const enums = await sql`
  select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public'
  group by t.typname
  order by t.typname
`;
const enumNames = new Set(enums.map((e) => e.name));

const tsType = (col) => {
  const { data_type, udt_name } = col;
  if (data_type === "ARRAY") {
    const inner = udt_name.replace(/^_/, "");
    return enumNames.has(inner)
      ? `Database["public"]["Enums"]["${inner}"][]`
      : `${scalar(inner)}[]`;
  }
  if (enumNames.has(udt_name)) {
    return `Database["public"]["Enums"]["${udt_name}"]`;
  }
  return scalar(udt_name);
};

const columns = await sql`
  select c.table_name, c.column_name, c.data_type, c.udt_name, c.is_nullable,
         c.column_default, c.is_generated, c.is_identity,
         t.table_type
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
  order by c.table_name, c.ordinal_position
`;

const byTable = new Map();
for (const c of columns) {
  if (!byTable.has(c.table_name)) {
    byTable.set(c.table_name, { isView: c.table_type === "VIEW", cols: [] });
  }
  byTable.get(c.table_name).cols.push(c);
}

// Functions installed by extensions (pgcrypto, btree_gist) live in `public`
// too. They are not part of the application's API and their overloads would
// collide as duplicate TypeScript identifiers, so they are excluded.
const fnRows = await sql`
  select distinct p.proname as name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid
        and d.classid = 'pg_proc'::regclass
        and d.deptype = 'e'
    )
  order by p.proname
`;

// Foreign keys, in the shape postgrest-js expects. Without a `Relationships`
// key on every table and view the schema fails to match GenericSchema and every
// `.from()` call silently resolves to `never`.
const fkRows = await sql`
  select
    con.conname                                   as fk_name,
    src.relname                                   as table_name,
    array_agg(sa.attname order by u.ord)          as columns,
    tgt.relname                                   as referenced_relation,
    array_agg(ta.attname order by u.ord)          as referenced_columns,
    exists (
      select 1 from pg_index i
      where i.indrelid = con.conrelid
        and i.indisunique
        and i.indnatts = array_length(con.conkey, 1)
        and con.conkey::int2[] <@ i.indkey::int2[]
    )                                             as is_one_to_one
  from pg_constraint con
  join pg_class src on src.oid = con.conrelid
  join pg_class tgt on tgt.oid = con.confrelid
  join pg_namespace n on n.oid = src.relnamespace
  cross join lateral unnest(con.conkey, con.confkey) with ordinality as u(sk, tk, ord)
  join pg_attribute sa on sa.attrelid = con.conrelid and sa.attnum = u.sk
  join pg_attribute ta on ta.attrelid = con.confrelid and ta.attnum = u.tk
  where con.contype = 'f' and n.nspname = 'public'
  group by con.conname, src.relname, tgt.relname, con.conrelid, con.conkey, con.confkey
  order by src.relname, con.conname
`;

const fksByTable = new Map();
for (const fk of fkRows) {
  if (!fksByTable.has(fk.table_name)) fksByTable.set(fk.table_name, []);
  fksByTable.get(fk.table_name).push(fk);
}

const relationshipLines = (table, indent) => {
  const fks = fksByTable.get(table) ?? [];
  if (fks.length === 0) return [`${indent}Relationships: [];`];
  const out = [`${indent}Relationships: [`];
  for (const fk of fks) {
    out.push(`${indent}  {`);
    out.push(`${indent}    foreignKeyName: "${fk.fk_name}";`);
    out.push(`${indent}    columns: [${fk.columns.map((c) => `"${c}"`).join(", ")}];`);
    out.push(`${indent}    isOneToOne: ${fk.is_one_to_one};`);
    out.push(`${indent}    referencedRelation: "${fk.referenced_relation}";`);
    out.push(
      `${indent}    referencedColumns: [${fk.referenced_columns.map((c) => `"${c}"`).join(", ")}];`
    );
    out.push(`${indent}  },`);
  }
  out.push(`${indent}];`);
  return out;
};

const lines = [];
lines.push(`// AUTO-GENERATED by scripts/gen-types.mjs - do not edit by hand.`);
lines.push(`// Regenerate after changing supabase/migrations:`);
lines.push(`//   bash supabase/local/rebuild.sh`);
lines.push(`//   node scripts/gen-types.mjs "postgresql://postgres@localhost:55432/drp_test"`);
lines.push(``);
lines.push(`export type Json =`);
lines.push(`  | string`);
lines.push(`  | number`);
lines.push(`  | boolean`);
lines.push(`  | null`);
lines.push(`  | { [key: string]: Json | undefined }`);
lines.push(`  | Json[];`);
lines.push(``);
lines.push(`export type Database = {`);
lines.push(`  public: {`);

// ---- Tables -------------------------------------------------------------
lines.push(`    Tables: {`);
for (const [table, { isView, cols }] of [...byTable].sort()) {
  if (isView) continue;
  lines.push(`      ${table}: {`);
  lines.push(`        Row: {`);
  for (const c of cols) {
    const nullable = c.is_nullable === "YES" ? " | null" : "";
    lines.push(`          ${c.column_name}: ${tsType(c)}${nullable};`);
  }
  lines.push(`        };`);

  lines.push(`        Insert: {`);
  for (const c of cols) {
    if (c.is_generated === "ALWAYS") continue; // generated columns are read-only
    const hasDefault = c.column_default !== null || c.is_identity === "YES";
    const optional = hasDefault || c.is_nullable === "YES" ? "?" : "";
    const nullable = c.is_nullable === "YES" ? " | null" : "";
    lines.push(`          ${c.column_name}${optional}: ${tsType(c)}${nullable};`);
  }
  lines.push(`        };`);

  lines.push(`        Update: {`);
  for (const c of cols) {
    if (c.is_generated === "ALWAYS") continue;
    const nullable = c.is_nullable === "YES" ? " | null" : "";
    lines.push(`          ${c.column_name}?: ${tsType(c)}${nullable};`);
  }
  lines.push(`        };`);
  lines.push(...relationshipLines(table, "        "));
  lines.push(`      };`);
}
lines.push(`    };`);

// ---- Views --------------------------------------------------------------
lines.push(`    Views: {`);
for (const [table, { isView, cols }] of [...byTable].sort()) {
  if (!isView) continue;
  lines.push(`      ${table}: {`);
  lines.push(`        Row: {`);
  for (const c of cols) {
    lines.push(`          ${c.column_name}: ${tsType(c)} | null;`);
  }
  lines.push(`        };`);
  lines.push(`        Relationships: [];`);
  lines.push(`      };`);
}
lines.push(`    };`);

// ---- Functions ----------------------------------------------------------
lines.push(`    Functions: {`);
for (const f of fnRows) {
  lines.push(`      ${f.name}: {`);
  lines.push(`        Args: Record<string, unknown>;`);
  lines.push(`        Returns: unknown;`);
  lines.push(`      };`);
}
lines.push(`    };`);

// ---- Enums --------------------------------------------------------------
lines.push(`    Enums: {`);
for (const e of enums) {
  lines.push(`      ${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")};`);
}
lines.push(`    };`);
lines.push(`    CompositeTypes: { [_ in never]: never };`);
lines.push(`  };`);
lines.push(`};`);
lines.push(``);
lines.push(`// Convenience aliases used across the app.`);
lines.push(`type PublicSchema = Database["public"];`);
lines.push(`export type Tables<T extends keyof PublicSchema["Tables"]> =`);
lines.push(`  PublicSchema["Tables"][T]["Row"];`);
lines.push(`export type TablesInsert<T extends keyof PublicSchema["Tables"]> =`);
lines.push(`  PublicSchema["Tables"][T]["Insert"];`);
lines.push(`export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =`);
lines.push(`  PublicSchema["Tables"][T]["Update"];`);
lines.push(`export type Views<T extends keyof PublicSchema["Views"]> =`);
lines.push(`  PublicSchema["Views"][T]["Row"];`);
lines.push(`export type Enums<T extends keyof PublicSchema["Enums"]> =`);
lines.push(`  PublicSchema["Enums"][T];`);
lines.push(``);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"), "utf8");

console.log(
  `Wrote ${OUT}: ${[...byTable.values()].filter((t) => !t.isView).length} tables, ` +
    `${[...byTable.values()].filter((t) => t.isView).length} views, ${enums.length} enums`
);

await sql.end();
