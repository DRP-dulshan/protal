-- ============================================================================
-- D|R|P PMS - owner financial isolation (0014)
--
-- Runs after 02_smoke_test.sql and reuses its fixtures. Each test signs in as
-- an owner the way PostgREST would (role `authenticated` + JWT subject) and
-- tries to reach money the way a curious owner with the public key could:
-- straight at the tables, through the reporting views, and through writes.
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/03_owner_isolation_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Extra fixtures: an issued statement, a named guest, owner documents, a
-- maintenance block, and an unconfirmed request that owners must not see.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit_a uuid := (select id from units where unit_number = '1204');
  v_unit_b uuid := (select id from units where unit_number = '2807');
  v_owner_a uuid := (select id from owners where email = 'owner.a@example.com');
  v_guest uuid;
begin
  update owner_statements set status = 'issued';

  insert into guests (full_name, email) values ('Maria Lopez Garcia', 'maria@example.com')
  returning id into v_guest;
  update bookings set guest_id = v_guest
   where unit_id = v_unit_b and check_in = '2026-09-15';

  insert into bookings (unit_id, channel, status, check_in, check_out, adults, gross_total_aed)
  values (v_unit_b, 'direct', 'inquiry', '2026-10-01', '2026-10-04', 2, 2100);

  insert into availability_blocks (unit_id, start_date, end_date, reason, note)
  values (v_unit_b, '2026-11-01', '2026-11-05', 'maintenance', 'Repaint - quote AED 4,000');

  insert into documents (kind, entity_kind, entity_id, unit_id, owner_id, title,
                         storage_path, file_name, is_owner_visible)
  values
    ('title_deed', 'unit', v_unit_a, v_unit_a, v_owner_a, 'Title deed 1204',
     'unit/a/title.pdf', 'title.pdf', true),
    ('owner_statement', 'owner', v_owner_a, v_unit_a, v_owner_a, 'Statement Jan',
     'owner/a/stmt.pdf', 'stmt.pdf', true),
    ('tenancy_contract', 'lease', null, v_unit_a, v_owner_a, 'Tenancy 1204',
     'lease/a/contract.pdf', 'contract.pdf', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 12 - an owner reads nothing from any table or view carrying money.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  n integer;
  leaks text[] := '{}';
begin
  foreach t in array array[
    'units', 'v_units_overview', 'v_unit_financials', 'v_occupancy_daily',
    'bookings', 'booking_guests', 'availability_blocks', 'housekeeping_tasks',
    'leases', 'lease_installments', 'deposit_transactions', 'rent_increase_notices',
    'lease_occupants', 'direct_debit_mandates',
    'channel_listings', 'nightly_rates', 'pricing_connections',
    'management_agreements', 'unit_ownerships',
    'ledger_entries', 'owner_statements', 'owner_statement_lines',
    'invoices', 'invoice_lines', 'payments', 'payment_allocations',
    'messages', 'company_settings', 'audit_log'
  ]
  loop
    foreach n in array array[1, 2] loop
      -- n doubles as the owner selector: 1 = owner A (long-term), 2 = owner B (holiday home)
      set local role authenticated;
      perform set_config('request.jwt.claim.sub',
        case n when 1 then '33333333-3333-3333-3333-333333333333'
               else '44444444-4444-4444-4444-444444444444' end, true);
      execute format('select count(*) from %I', t) into n;
      reset role;
      if n > 0 then leaks := leaks || t; end if;
    end loop;
  end loop;

  if cardinality(leaks) > 0 then
    raise exception 'TEST 12 FAILED: owners can read rows from %', leaks;
  end if;
  raise notice 'TEST 12  PASS  owners read 0 rows from all 29 financial tables and views';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 13 - the owner views expose no money columns at all.
-- ---------------------------------------------------------------------------
do $$
declare bad text;
begin
  select string_agg(table_name || '.' || column_name, ', ') into bad
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('owner_units_view', 'owner_bookings_view', 'owner_calendar_blocks_view')
    and column_name ~ '(aed|rate|price|payout|commission|fee|amount|income|revenue|total|cost|deposit|note)';

  if bad is not null then
    raise exception 'TEST 13 FAILED: owner views expose %', bad;
  end if;
  raise notice 'TEST 13  PASS  owner views carry no money columns';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 14 - each owner sees exactly their own confirmed stays.
-- ---------------------------------------------------------------------------
do $$
declare
  n_a integer; n_b integer; n_units_b integer; n_blocks_b integer;
  first_name text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into n_a from owner_bookings_view;

  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into n_b from owner_bookings_view;
  select count(*) into n_units_b from owner_units_view;
  select count(*) into n_blocks_b from owner_calendar_blocks_view;
  select guest_first_name into first_name from owner_bookings_view where check_in = '2026-09-15';
  reset role;

  if n_a <> 0 then raise exception 'TEST 14 FAILED: owner A sees % of owner B''s bookings', n_a; end if;
  -- Two confirmed stays; the unconfirmed request must not appear.
  if n_b <> 2 then raise exception 'TEST 14 FAILED: owner B sees % bookings, expected 2', n_b; end if;
  if n_units_b <> 1 then raise exception 'TEST 14 FAILED: owner B sees % units', n_units_b; end if;
  if n_blocks_b <> 1 then raise exception 'TEST 14 FAILED: owner B sees % blocks', n_blocks_b; end if;
  if first_name is not null then
    raise exception 'TEST 14 FAILED: guest name "%" shown while the setting is off', first_name;
  end if;
  raise notice 'TEST 14  PASS  owner B sees own 2 confirmed stays, owner A sees none, guest name hidden';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 15 - the guest first name appears only once the admin enables it.
-- ---------------------------------------------------------------------------
update company_settings set show_guest_first_name_to_owners = true;
do $$
declare first_name text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select guest_first_name into first_name from owner_bookings_view where check_in = '2026-09-15';
  reset role;
  if first_name is distinct from 'Maria' then
    raise exception 'TEST 15 FAILED: expected first name Maria, got %', first_name;
  end if;
  raise notice 'TEST 15  PASS  first name only (%), and only with the setting on', first_name;
end;
$$;
update company_settings set show_guest_first_name_to_owners = false;

-- ---------------------------------------------------------------------------
-- TEST 16 - the views are read-only, even the auto-updatable one.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit_b uuid := (select id from units where unit_number = '2807');
  refused integer := 0;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

  begin
    insert into owner_calendar_blocks_view (unit_id, start_date, end_date, reason)
    values (v_unit_b, '2027-01-01', '2027-01-05', 'owner_stay');
  exception when insufficient_privilege then refused := refused + 1;
  end;
  begin
    update owner_bookings_view set check_out = check_out + 1;
  exception when insufficient_privilege or object_not_in_prerequisite_state or feature_not_supported then
    refused := refused + 1;
  end;
  begin
    delete from owner_units_view;
  exception when insufficient_privilege or object_not_in_prerequisite_state or feature_not_supported then
    refused := refused + 1;
  end;
  reset role;

  if refused <> 3 then raise exception 'TEST 16 FAILED: % of 3 writes refused', refused; end if;
  raise notice 'TEST 16  PASS  insert/update/delete through owner views refused';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 17 - documents: owners keep deeds, lose anything stating income.
-- ---------------------------------------------------------------------------
do $$
declare kinds text;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select string_agg(kind::text, ',' order by kind::text) into kinds from documents;
  reset role;
  if kinds is distinct from 'title_deed' then
    raise exception 'TEST 17 FAILED: owner A sees documents %', kinds;
  end if;
  raise notice 'TEST 17  PASS  owner sees title deed; statement and tenancy contract hidden';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 18 - owners can still approve maintenance, and see the quote (a cost).
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit_a uuid := (select id from units where unit_number = '1204');
  v_ticket uuid;
  quote numeric;
  threshold numeric;
begin
  insert into maintenance_requests (unit_id, category, title, quoted_amount_aed, cost_borne_by, status)
  values (v_unit_a, 'plumbing', 'Water heater', 2400, 'owner', 'awaiting_owner_approval')
  returning id into v_ticket;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select quoted_amount_aed into quote from maintenance_requests where id = v_ticket;
  select maintenance_owner_approval_threshold into threshold from portal_settings();
  update maintenance_requests
     set owner_approved_at = now(),
         owner_approved_by = '33333333-3333-3333-3333-333333333333',
         status = 'approved'
   where id = v_ticket;
  reset role;

  if quote <> 2400 then raise exception 'TEST 18 FAILED: owner cannot see the quote'; end if;
  if threshold is null then raise exception 'TEST 18 FAILED: portal_settings() empty for owner'; end if;
  if (select status from maintenance_requests where id = v_ticket) <> 'approved' then
    raise exception 'TEST 18 FAILED: owner approval did not apply';
  end if;
  raise notice 'TEST 18  PASS  owner sees quote AED % and approves it (threshold AED %)', quote, threshold;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 19 - staff are unaffected: they still see every money column.
-- ---------------------------------------------------------------------------
do $$
declare gross numeric; stmts integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select gross_total_aed into gross from bookings where channel = 'airbnb' and check_in = '2026-09-10';
  perform set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);
  select count(*) into stmts from owner_statements;
  reset role;

  if gross is distinct from 3600 then raise exception 'TEST 19 FAILED: PM sees gross %', gross; end if;
  if stmts < 1 then raise exception 'TEST 19 FAILED: finance sees % statements', stmts; end if;
  raise notice 'TEST 19  PASS  staff still see booking revenue (AED %) and statements', gross;
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 20 - a self-service sign-up cannot choose its own role.
-- ---------------------------------------------------------------------------
do $$
declare r app_role;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values ('77777777-7777-7777-7777-777777777777', 'attacker@example.com',
          '{"full_name":"Mallory","role":"super_admin"}');
  select role into r from profiles where id = '77777777-7777-7777-7777-777777777777';
  if r <> 'guest' then
    raise exception 'TEST 20 FAILED: sign-up with role metadata became %', r;
  end if;
  raise notice 'TEST 20  PASS  role in sign-up metadata ignored; account is %', r;
end;
$$;

select 'ALL OWNER ISOLATION TESTS PASSED' as result;
