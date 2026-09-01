#!/usr/bin/env bash
# Rebuild the local validation database from scratch and run the smoke test.
set -euo pipefail
PGBIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"
PORT="${PGPORT:-55432}"
DB="${PGDATABASE:-drp_test}"
psql() { "$PGBIN/psql" -h localhost -p "$PORT" -U postgres "$@"; }

psql -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/local/00_shim.sql
for f in supabase/migrations/0*.sql; do
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/local/02_smoke_test.sql
