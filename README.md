# D|R|P Property Management System

Back-office and portal system for D|R|P's Dubai property management operation —
long-term leasing, Holiday Homes, owner and tenant portals, finance and
regulatory compliance.

Built UAE-first: AED base currency, per-line-item VAT, and Ejari / DET / Mollak
modelled as first-class concerns rather than optional fields.

> This is the operational system, not the public listing site.

## Quick start

```bash
npm install
cp .env.example .env.local     # fill in your Supabase values
npm run dev
```

Open http://localhost:3000 (or http://admin.localhost:3000) for the back
office and http://owner.localhost:3000 for the owner portal.

Without credentials the app serves `/setup`, which lists exactly what is
missing — it will not crash with a stack trace.

### Database

Put your Supabase connection string in `DATABASE_URL` in `.env.local`
(Supabase → Connect → Session pooler), then install the schema and the demo
data in one step:

```bash
npm run db:setup -- --seed
```

Or apply the migrations in `supabase/migrations/` in filename order, via the
Supabase SQL editor or the CLI:

```bash
supabase db push
```

Then optionally load the demo portfolio (3 buildings, 5 units, 3 owners, 2
tenancies, a licensed holiday home, an owner statement and a realistic
compliance backlog):

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
```

Create your first user in Supabase → Authentication → Users, then:

```sql
update profiles set role = 'super_admin' where email = 'you@drp.ae';
```

Staff access is deny-by-default. A property manager sees nothing until they are
assigned units or a property — see the notes at the end of `supabase/seed.sql`.

## Verifying the schema

The database rules are tested against a real PostgreSQL instance, no Supabase
project required. `supabase/local/00_shim.sql` reproduces the small Supabase
surface the schema touches (`auth.uid()`, `auth.users`, `storage.*`).

```bash
bash supabase/local/rebuild.sh
```

This applies every migration to a scratch database and runs 17 assertions
covering ownership limits, cheque schedules, ledger posting, owner-statement
arithmetic, the DET permit gate, double-booking prevention, Ejari occupant
staleness, the maintenance approval threshold and RLS isolation.

## Regenerating types

`src/lib/db/database.types.ts` is generated from the live schema, so the SQL
migrations remain the single source of truth:

```bash
bash supabase/local/rebuild.sh
node scripts/gen-types.mjs "postgresql://postgres@localhost:55432/drp_test"
```

Point it at your Supabase connection string to generate from the real project
instead.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:rebuild` | Rebuild the local validation DB and run the smoke test |
| `npm run db:types` | Regenerate TypeScript types from a database |
| `npm run db:setup -- --seed` | Install the schema and demo data into the database in `DATABASE_URL` |
| `npm run db:concat` | Regenerate `supabase/ALL_MIGRATIONS.sql` after adding a migration |

## Layout

```
src/app/(staff)/     back office — dashboard, units, owners, leases, finance, compliance, settings
src/app/portal/      owner / tenant / guest portals
src/lib/             env, auth + RBAC, storage, messaging, payments, money, dates, labels
src/components/      ui primitives, domain components, layout
supabase/migrations/ the schema, RLS policies and business-logic functions
supabase/local/      Postgres shim + smoke test for offline verification
docs/ARCHITECTURE.md schema, access model, routes, components, integration seams
```

Read `docs/ARCHITECTURE.md` first — it explains the access model and the
Dubai-specific rules the database enforces.

## Status

**Phase 1 is complete end to end** — including create forms for properties,
units, owners and tenancies, the owner portal, and minimal read-only portals for
tenants and guests. Edit forms are the one gap: records are created in the app
and amended in the database for now.

Phase 2's data model (Holiday Homes, DET permits, bookings, housekeeping,
maintenance, communications) is fully built, constrained, RLS-protected and
seeded; only its back-office screens remain, and they need no migration.
Phase 3 has integration points reserved.
