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
