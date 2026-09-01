-- ============================================================================
-- D|R|P PMS - 0012 Explicit privilege grants
--
-- Supabase grants privileges on new public tables to anon/authenticated by
-- default. We do not rely on that: `anon` gets nothing, and `authenticated`
-- gets table privileges that RLS then narrows row by row. Being explicit means
-- the security posture survives a project restore or a move off Supabase.
-- ============================================================================

grant usage on schema public to authenticated, service_role;

-- Unauthenticated callers get no access to business data at all.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

grant usage on schema pms to authenticated, service_role;
grant execute on all functions in schema pms to authenticated, service_role;
grant usage, select on all sequences in schema pms to authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- The audit log is append-only from the application's point of view: only the
-- SECURITY DEFINER trigger writes to it.
revoke insert, update, delete on audit_log from authenticated;

-- Ledger entries carrying a statement_id are historical record. Deleting them
-- would silently rewrite an issued owner statement.
revoke delete on owner_statement_lines from authenticated;
