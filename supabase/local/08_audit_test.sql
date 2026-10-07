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

-- ---------------------------------------------------------------------------
-- TEST 53 - website listings (0028): staff read, editors write, finance reads
-- only, owners and tenants see nothing; bad slugs and prices are refused.
-- ---------------------------------------------------------------------------
do $$
declare
  l uuid;
  n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into website_listings (slug, title, offering, price_aed, property_type, area, beds, baths, size_sqft, status, images)
  values ('2-br-marina-gate-for-rent', '2 BR in Marina Gate', 'rent', 180000, 'Apartment', 'Dubai Marina', 2, 2, 1200,
          'published', '["https://example.com/a.jpg"]')
  returning id into l;
  update website_listings set price_aed = 175000 where id = l;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
  select count(*) into n from website_listings where id = l;
  assert n = 1, 'finance reads listings';
  begin
    insert into website_listings (slug, title, offering, price_aed, property_type, area, size_sqft)
    values ('finance-try', 'Finance listing', 'buy', 1, 'Villa', 'Jumeirah', 100);
    raise exception 'finance must not add listings';
  exception when insufficient_privilege then null;
  end;
  update website_listings set price_aed = 1 where id = l;
  reset role;
  assert (select price_aed from website_listings where id = l) = 175000, 'finance cannot change a listing';

  foreach n in array array[3, 5] loop
    set local role authenticated;
    perform set_config('request.jwt.claim.sub',
      case n when 3 then '33333333-3333-3333-3333-333333333333' else '55555555-5555-5555-5555-555555555555' end, true);
    assert not exists (select 1 from website_listings), 'owners and tenants see no listings';
    reset role;
  end loop;

  begin
    insert into website_listings (slug, title, offering, price_aed, property_type, area, size_sqft)
    values ('Bad Slug!', 'Bad', 'buy', 100, 'Villa', 'Jumeirah', 100);
    raise exception 'a bad slug must be refused';
  exception when check_violation then null;
  end;
  begin
    insert into website_listings (slug, title, offering, price_aed, property_type, area, size_sqft)
    values ('zero-price', 'Zero price', 'buy', 0, 'Villa', 'Jumeirah', 100);
    raise exception 'a zero price must be refused';
  exception when check_violation then null;
  end;

  assert exists (select 1 from storage.buckets where id = 'listing-photos' and public), 'public photo bucket';
  delete from website_listings where id = l;
  raise notice 'TEST 53  PASS  website listings: staff read, editors write, owners/tenants none; slugs and prices checked';
end $$;
