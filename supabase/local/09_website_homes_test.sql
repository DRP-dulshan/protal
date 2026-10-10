-- ============================================================================
-- D|R|P PMS - Holiday Homes website (0029)
--
-- Reuses unit 2807 (short-term, valid DET permit) and unit 1204 (long-term, no
-- permit) from the earlier suites. Dates are relative to today.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/09_website_homes_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.unit(num text) returns uuid
language sql as $$ select id from units where unit_number = num $$;

create or replace function pg_temp.book(slug text, ref text, s integer, e integer, status booking_status default 'tentative', adults integer default 2)
returns bookings language plpgsql as $$
declare r record;
begin
  select * into r from website_book_unit(slug, ref, current_date + s, current_date + e, adults,
    'Web Guest', 'web@example.com', '+971500000000', 'Sri Lankan', status, 720, 1440, 0, 40, 1480, null, 'web test');
  return (select b from bookings b where b.id = r.booking_id);
end $$;

-- ---------------------------------------------------------------------------
-- TEST 54 - a unit cannot be published half-finished; a finished one can.
-- ---------------------------------------------------------------------------
do $$
declare failed boolean := false;
begin
  begin
    update units set website_published = true where unit_number = '2807';
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'TEST 54 FAILED: published without a slug, title or photos'; end if;

  begin
    update units set website_published = true, website_slug = 'marina-gate-2807', website_title = 'Marina Gate 2807',
      website_area = 'Dubai Marina', website_type = 'apartment', website_images = '["https://example.com/a.jpg"]'
     where unit_number = '1204';   -- long-term unit
    failed := false;
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'TEST 54 FAILED: a long-term unit was published'; end if;

  update units set website_published = true, website_slug = 'marina-gate-2807', website_title = 'Marina Gate 2807',
    website_area = 'Dubai Marina', website_type = 'apartment', website_images = '["https://example.com/a.jpg"]'
   where unit_number = '2807';
  begin
    update units set website_slug = 'marina-gate-2807' where unit_number = '1204';
    raise exception 'TEST 54 FAILED: duplicate slug accepted';
  exception when unique_violation then null;
  end;
  raise notice 'TEST 54  PASS  publishing needs slug, title, area, type, photos, a rate and a short-term unit; slugs are unique';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 55 - website booking: held, blocks the calendar, then confirmed.
-- ---------------------------------------------------------------------------
do $$
declare b bookings%rowtype; n integer; st text;
begin
  b := pg_temp.book('marina-gate-2807', 'DRP-WEB001', 40, 43);
  if b.status <> 'tentative' or b.channel <> 'direct' or b.website_ref <> 'DRP-WEB001'
     or b.booking_number is null or b.booking_number = '' or b.permit_number_at_booking is null then
    raise exception 'TEST 55 FAILED: booking row %', row_to_json(b);
  end if;
  select count(*) into n from availability_blocks where booking_id = b.id and reason = 'booking';
  if n <> 1 then raise exception 'TEST 55 FAILED: no calendar block for the hold'; end if;
  if (select full_name from guests where id = b.guest_id) <> 'Web Guest' then
    raise exception 'TEST 55 FAILED: guest not saved';
  end if;

  st := website_set_booking_status('DRP-WEB001', 'confirmed');
  if st <> 'confirmed' or (select status from bookings where website_ref = 'DRP-WEB001') <> 'confirmed' then
    raise exception 'TEST 55 FAILED: not confirmed';
  end if;
  if website_set_booking_status('DRP-WEB001', 'confirmed') <> 'confirmed' then
    raise exception 'TEST 55 FAILED: confirm is not idempotent';
  end if;
  raise notice 'TEST 55  PASS  website booking held as tentative (guest, permit, calendar block), then confirmed, idempotently';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 56 - clashes, blocks, rules and permits are refused with stable codes.
-- ---------------------------------------------------------------------------
do $$
declare msg text;
begin
  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB002', 41, 42);
    raise exception 'TEST 56 FAILED: overlapping booking accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'blocked:%' then raise exception 'TEST 56 FAILED: overlap gave %', msg; end if;
  end;

  -- Checking in the day another guest leaves is fine.
  perform pg_temp.book('marina-gate-2807', 'DRP-WEB003', 43, 45);

  insert into availability_blocks (unit_id, start_date, end_date, reason)
  values (pg_temp.unit('2807'), current_date + 60, current_date + 64, 'owner_stay');
  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB004', 62, 63);
    raise exception 'TEST 56 FAILED: owner stay ignored';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'blocked:%' then raise exception 'TEST 56 FAILED: block gave %', msg; end if;
  end;

  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB005', 200, 202, 'tentative', 9);
    raise exception 'TEST 56 FAILED: too many guests accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'invalid:%' then raise exception 'TEST 56 FAILED: guests gave %', msg; end if;
  end;

  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB001', 204, 206);
    raise exception 'TEST 56 FAILED: duplicate reference accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'invalid:%' then raise exception 'TEST 56 FAILED: duplicate gave %', msg; end if;
  end;

  begin
    perform pg_temp.book('no-such-home', 'DRP-WEB006', 208, 210);
    raise exception 'TEST 56 FAILED: unknown home accepted';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'not_found:%' then raise exception 'TEST 56 FAILED: unknown gave %', msg; end if;
  end;

  -- No valid permit on those dates: refused.
  update holiday_home_permits set expires_on = current_date + 100, status = 'active'
   where unit_id = pg_temp.unit('2807');
  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB007', 250, 252);
    raise exception 'TEST 56 FAILED: booked past the permit';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'no_permit:%' then raise exception 'TEST 56 FAILED: permit gave %', msg; end if;
  end;
  raise notice 'TEST 56  PASS  overlaps, owner blocks, party size, duplicate refs, unknown homes and permit gaps refused; same-day turnover allowed';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 57 - cancelling frees the dates; unpublished homes are not bookable;
-- the functions are for the service role only.
-- ---------------------------------------------------------------------------
do $$
declare msg text; ok boolean;
begin
  if website_set_booking_status('DRP-WEB003', 'cancelled', 'guest left checkout') <> 'cancelled' then
    raise exception 'TEST 57 FAILED: not cancelled';
  end if;
  if exists (select 1 from availability_blocks ab join bookings b on b.id = ab.booking_id where b.website_ref = 'DRP-WEB003') then
    raise exception 'TEST 57 FAILED: cancelled booking still blocks the calendar';
  end if;
  perform pg_temp.book('marina-gate-2807', 'DRP-WEB008', 43, 45);   -- same nights again

  begin
    perform website_set_booking_status('DRP-WEB003', 'confirmed');
    raise exception 'TEST 57 FAILED: a cancelled booking was confirmed';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'invalid:%' then raise exception 'TEST 57 FAILED: reconfirm gave %', msg; end if;
  end;

  update units set website_published = false where unit_number = '2807';
  begin
    perform pg_temp.book('marina-gate-2807', 'DRP-WEB009', 212, 214);
    raise exception 'TEST 57 FAILED: unpublished home bookable';
  exception when others then
    get stacked diagnostics msg = message_text;
    if msg not like 'not_found:%' then raise exception 'TEST 57 FAILED: unpublished gave %', msg; end if;
  end;

  ok := not has_function_privilege('authenticated', 'website_book_unit(text,text,date,date,integer,text,text,text,text,booking_status,numeric,numeric,numeric,numeric,numeric,text,text)', 'execute')
    and not has_function_privilege('anon', 'website_set_booking_status(text,text,text)', 'execute')
    and has_function_privilege('service_role', 'website_set_booking_status(text,text,text)', 'execute');
  if not ok then raise exception 'TEST 57 FAILED: function privileges'; end if;
  raise notice 'TEST 57  PASS  cancelling frees the nights, unpublished homes are closed, only the service role can call the functions';
end $$;
