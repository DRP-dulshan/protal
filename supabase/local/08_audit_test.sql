-- ============================================================================
-- D|R|P PMS - Fixes from the October 2026 review
--
-- Reuses the 02 fixtures: unit 2807 owned by owner B (profile 44444444-...),
-- unit 1204 owned by owner A (profile 33333333-...).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/08_audit_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- TEST 52 - documents filed on a unit (no owner on the row) reach that unit's
-- owner when shared, and only then; never another owner, never income.
-- ---------------------------------------------------------------------------
do $$
declare
  v_mine  uuid := (select id from units where unit_number = '2807');
  v_other uuid := (select id from units where unit_number = '1204');
  shared uuid; hidden uuid; others uuid; income uuid;
  sees integer;
begin
  insert into documents (kind, entity_kind, entity_id, unit_id, title, storage_path, file_name, is_owner_visible)
  values ('title_deed', 'unit', v_mine, v_mine, 'Title deed 2807', 'unit/x/deed.pdf', 'deed.pdf', true)
  returning id into shared;
  insert into documents (kind, entity_kind, entity_id, unit_id, title, storage_path, file_name, is_owner_visible)
  values ('inspection_report', 'unit', v_mine, v_mine, 'Internal inspection', 'unit/x/insp.pdf', 'insp.pdf', false)
  returning id into hidden;
  insert into documents (kind, entity_kind, entity_id, unit_id, title, storage_path, file_name, is_owner_visible)
  values ('det_permit', 'unit', v_other, v_other, 'Permit 1204', 'unit/y/permit.pdf', 'permit.pdf', true)
  returning id into others;
  insert into documents (kind, entity_kind, entity_id, unit_id, title, storage_path, file_name, is_owner_visible)
  values ('owner_statement', 'unit', v_mine, v_mine, 'Statement', 'unit/x/st.pdf', 'st.pdf', true)
  returning id into income;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  assert exists (select 1 from documents where id = shared), 'owner sees a shared document filed on their unit';
  assert not exists (select 1 from documents where id = hidden), 'owner does not see one not shared';
  assert not exists (select 1 from documents where id = others), 'owner does not see another owner''s unit document';
  assert not exists (select 1 from documents where id = income), 'owner never sees income documents';
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into sees from documents where id in (shared, hidden, income);
  assert sees = 0, 'the other owner sees none of unit 2807''s documents';
  assert exists (select 1 from documents where id = others), 'and does see their own unit''s shared document';
  reset role;

  delete from documents where id in (shared, hidden, others, income);
  raise notice 'TEST 52  PASS  shared unit documents reach that unit''s owner only; income stays hidden';
end $$;
