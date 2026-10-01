-- ============================================================================
-- D|R|P PMS - Past Airbnb stays from the earnings export (0021)
--
-- Reuses the 02 fixtures: unit 2807 (Marina Gate 1) owned by owner B
-- (44444444-...) and its property manager (22222222-...).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/07_history_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- TEST 43 - a stay that ended long ago is added as checked out by staff: no
-- permit needed for its dates, no turnover clean, no "new booking" alerts,
-- and the owner sees it in their portal. A confirmed stay still schedules a
-- clean as before.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  b uuid;
  live uuid;
  owner_sees integer;
begin
  update units set airbnb_listing_name = 'Chic Marina Studio' where id = v_unit;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, guest_count_known,
                        external_booking_id, accommodation_aed, gross_total_aed, payout_expected_aed)
  values (v_unit, 'airbnb', 'checked_out', '2020-03-01', '2020-03-06', 1, false,
          'HMPAST00001', 1000, 1000, 870)
  returning id into b;
  reset role;

  assert not exists (select 1 from housekeeping_tasks where booking_id = b),
    'no turnover clean for a stay recorded after it ended';
  assert not exists (select 1 from notifications where booking_id = b),
    'no new-booking notifications for history';
  assert not exists (select 1 from availability_blocks where booking_id = b),
    'history blocks no dates';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into owner_sees from owner_bookings_view where id = b;
  reset role;
  assert owner_sees = 1, 'the owner sees the past stay';

  -- Unchanged path: a confirmed stay still gets its clean.
  insert into bookings (unit_id, channel, status, check_in, check_out, adults, guest_count_known,
                        external_booking_id, ical_uid)
  values (v_unit, 'airbnb', 'confirmed', current_date + 200, current_date + 203, 1, false,
          'HMLIVE00001', 'test-live-uid@airbnb.com')
  returning id into live;
  assert exists (select 1 from housekeeping_tasks where booking_id = live and kind = 'turnover'),
    'a confirmed stay still schedules its turnover';

  raise notice 'TEST 43  PASS  past stays: checked out, no clean, no alerts, visible to the owner';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 44 - a current or upcoming stay from the earnings export: recorded
-- even without a permit for its dates (flagged), announced to nobody, and
-- adopted by the calendar sync later rather than duplicated.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  b uuid;
  r jsonb;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into bookings (booking_number, unit_id, channel, status, import_source, check_in, check_out,
                        adults, guest_count_known, external_booking_id)
  values ('', v_unit, 'airbnb', 'confirmed', 'earnings_csv', '2029-06-01', '2029-06-05', 1, false,
          'HMCSVLIVE01')
  returning id into b;
  reset role;

  assert (select imported_without_permit from bookings where id = b),
    'no permit covers 2029: recorded and flagged, not refused';
  assert not exists (select 1 from notifications where booking_id = b), 'a bulk import announces nothing';
  assert not exists (select 1 from messages where booking_id = b), 'and emails nobody';

  -- A stay typed by hand with no permit is still refused.
  begin
    insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
    values ('', v_unit, 'direct', 'confirmed', '2029-07-01', '2029-07-03', 1);
    raise exception 'a direct booking without a permit was accepted';
  exception when check_violation then null;
  end;

  -- The calendar feed later carries the same reservation: adopted, not duplicated.
  r := apply_airbnb_ical(v_unit, jsonb_build_array(jsonb_build_object(
         'uid', 'csv-live-uid@airbnb.com', 'start', '2029-06-01', 'end', '2029-06-05',
         'kind', 'reservation', 'code', 'HMCSVLIVE01')), null);
  assert (select count(*) from bookings where external_booking_id = 'HMCSVLIVE01') = 1, 'one booking';
  assert (select ical_uid from bookings where id = b) = 'csv-live-uid@airbnb.com', 'adopted by the feed';

  raise notice 'TEST 44  PASS  current/upcoming CSV stays: flagged not refused, silent, adopted by the feed';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 45 - owner booking emails are off by default: the owner still gets
-- the portal notification and the office its email; switched on, the owner
-- is emailed too.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  b uuid;
  c uuid;
begin
  update company_settings set email_owners_about_bookings = false where id;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 95, current_date + 97, 1)
  returning id into b;
  assert exists (select 1 from notifications n join profiles p on p.id = n.recipient_id
                  where n.booking_id = b and p.email = 'owner.b@example.com'), 'owner portal notification';
  assert not exists (select 1 from messages where booking_id = b and party_kind = 'owner'), 'no owner email';
  assert exists (select 1 from messages where booking_id = b and party_kind = 'staff'), 'office email';

  update company_settings set email_owners_about_bookings = true where id;
  insert into bookings (booking_number, unit_id, channel, status, check_in, check_out, adults)
  values ('', v_unit, 'direct', 'confirmed', current_date + 97, current_date + 99, 1)
  returning id into c;
  assert exists (select 1 from messages where booking_id = c and party_kind = 'owner'), 'owner emailed when on';
  update company_settings set email_owners_about_bookings = false where id;

  raise notice 'TEST 45  PASS  owner booking emails off by default; portal notice and office email unaffected';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 46 - ended, priced stays post their payout to the ledger once;
-- corrections follow until a statement includes the line; cancelled or
-- unpriced stays and future stays post nothing; owners cannot post.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  ended uuid;
  unpriced uuid;
  n integer;
  line record;
  st uuid;
begin
  insert into bookings (booking_number, unit_id, channel, status, import_source, check_in, check_out,
                        adults, external_booking_id, accommodation_aed, gross_total_aed, payout_expected_aed)
  values ('', v_unit, 'airbnb', 'checked_out', 'earnings_csv', '2021-05-01', '2021-05-04', 1,
          'HMLEDGER001', 1500, 1634, 1368.07)
  returning id into ended;
  insert into bookings (booking_number, unit_id, channel, status, import_source, check_in, check_out,
                        adults, external_booking_id)
  values ('', v_unit, 'airbnb', 'checked_out', 'earnings_csv', '2021-06-01', '2021-06-03', 1, 'HMLEDGER002')
  returning id into unpriced;

  -- An owner calling it posts nothing.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  assert post_completed_bookings() = 0, 'owners cannot post';
  -- Staff can.
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  n := post_completed_bookings();
  reset role;
  assert n >= 1, 'posted at least the ended stay';

  select le.*, gc.code into line from ledger_entries le join gl_categories gc on gc.id = le.category_id
   where le.source_table = 'bookings' and le.source_id = ended;
  assert line.amount_aed = 1368.07, 'the payout, not the guest total: ' || line.amount_aed;
  assert line.code = 'INC-BOOKING' and line.direction = 'income', 'booking income';
  assert line.entry_date = '2021-05-04', 'dated the check-out day';
  assert line.vat_amount_aed = 0 and not line.vat_applicable, 'no VAT';
  assert line.owner_id = (select owner_id from unit_ownerships where unit_id = v_unit and end_date is null
                           order by is_primary_contact desc, ownership_pct desc limit 1), 'the unit owner';
  assert line.booking_id = ended, 'linked to the booking';
  assert not exists (select 1 from ledger_entries where source_id = unpriced), 'an unpriced stay posts nothing';
  assert not exists (select 1 from ledger_entries le join bookings b on b.id = le.source_id
                      where le.source_table = 'bookings' and b.check_out > current_date), 'future stays post nothing';

  assert post_completed_bookings() = 0, 'running again posts nothing new';
  assert (select count(*) from ledger_entries where source_id = ended) = 1, 'still one line';

  -- A corrected payout follows; once in a statement it is frozen.
  update bookings set payout_expected_aed = 1400 where id = ended;
  perform post_completed_bookings();
  assert (select amount_aed from ledger_entries where source_id = ended) = 1400, 'correction followed';
  insert into owner_statements (statement_number, owner_id, period_start, period_end)
  values ('TEST-STMT-46', line.owner_id, '2021-05-01', '2021-05-31')
  returning id into st;
  update ledger_entries set statement_id = st where source_id = ended;
  update bookings set payout_expected_aed = 999 where id = ended;
  perform post_completed_bookings();
  assert (select amount_aed from ledger_entries where source_id = ended) = 1400, 'stated line frozen';
  update ledger_entries set statement_id = null where source_id = ended;
  delete from owner_statements where id = st;

  -- Cancelled after posting: the unstated line goes.
  update bookings set status = 'cancelled', cancelled_on = '2021-05-01' where id = ended;
  perform post_completed_bookings();
  assert not exists (select 1 from ledger_entries where source_id = ended), 'cancelled stay line removed';

  raise notice 'TEST 46  PASS  ended stays post their payout (no VAT, check-out date, owner); corrections follow until stated';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 47 - a holiday-home unit reads "listed", not "vacant": on insert, when
-- switched to short-term, and when a lease ends; switching back to long-term
-- makes it vacant again. Leased and other statuses are left alone.
-- ---------------------------------------------------------------------------
do $$
declare
  v_prop uuid := (select property_id from units where unit_number = '2807');
  u uuid;
begin
  insert into units (property_id, unit_number, kind, bedrooms, operating_mode)
  values (v_prop, 'T-STATUS-1', 'apartment', 1, 'short_term')
  returning id into u;
  assert (select status from units where id = u) = 'listed_short_term', 'new holiday home is listed';

  update units set operating_mode = 'long_term' where id = u;
  assert (select status from units where id = u) = 'vacant', 'taken off short-term: vacant';

  update units set operating_mode = 'both' where id = u;
  assert (select status from units where id = u) = 'listed_short_term', 'back to listed';

  update units set status = 'vacant' where id = u;  -- e.g. a lease ending
  assert (select status from units where id = u) = 'listed_short_term', 'vacant short-term unit stays listed';

  update units set status = 'occupied_long_term' where id = u;
  assert (select status from units where id = u) = 'occupied_long_term', 'a lease is left alone';
  update units set status = 'off_market' where id = u;
  assert (select status from units where id = u) = 'off_market', 'other statuses are left alone';

  delete from units where id = u;
  raise notice 'TEST 47  PASS  holiday-home units are listed, not vacant';
end $$;
