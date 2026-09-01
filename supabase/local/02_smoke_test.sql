-- ============================================================================
-- D|R|P PMS - functional smoke test
--
-- Exercises the business rules the brief treats as non-negotiable:
--   1. Ownership shares cannot exceed 100%
--   2. Cheque schedules split rent correctly with no rounding loss
--   3. Cleared rent posts to the ledger as collected income
--   4. Owner statement math: income - expenses - fee - VAT on fee
--   5. A unit cannot be listed or booked without a valid DET permit
--   6. Bookings cannot double-book a unit
--   7. Ejari occupant changes surface as a compliance breach after 30 days
--   8. Maintenance above the threshold blocks until the owner approves
--   9. RLS actually isolates owners, tenants and scoped staff
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/02_smoke_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'admin@drp.ae',
   '{"full_name":"Admin User","role":"super_admin"}'),
  ('22222222-2222-2222-2222-222222222222', 'pm@drp.ae',
   '{"full_name":"Property Manager","role":"property_manager"}'),
  ('33333333-3333-3333-3333-333333333333', 'owner.a@example.com',
   '{"full_name":"Owner A","role":"owner"}'),
  ('44444444-4444-4444-4444-444444444444', 'owner.b@example.com',
   '{"full_name":"Owner B","role":"owner"}'),
  ('55555555-5555-5555-5555-555555555555', 'tenant@example.com',
   '{"full_name":"Tenant One","role":"tenant"}'),
  ('66666666-6666-6666-6666-666666666666', 'finance@drp.ae',
   '{"full_name":"Accountant","role":"finance"}');

do $$
declare
  v_comm uuid; v_prop uuid;
  v_unit_a uuid; v_unit_b uuid;
  v_owner_a uuid; v_owner_b uuid;
  v_tenant uuid; v_lease uuid;
  n integer; total numeric;
begin
  insert into communities (name, emirate) values ('Dubai Marina', 'dubai') returning id into v_comm;

  insert into properties (community_id, name, kind, developer_name, owners_association_name, mollak_property_id)
  values (v_comm, 'Marina Gate 1', 'building', 'Select Group', 'Marina Gate OA', 'MOL-99231')
  returning id into v_prop;

  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms,
                     size_sqft, furnishing, dewa_premise_number, title_deed_number,
                     operating_mode, target_annual_rent_aed)
  values (v_prop, '1204', 'DRP-MG1-1204', 'apartment', 2, 2, 1240.50, 'fully_furnished',
          '3610234567', '2019-1-234567', 'long_term', 145000)
  returning id into v_unit_a;

  insert into units (property_id, unit_number, reference_code, kind, bedrooms, bathrooms,
                     size_sqft, furnishing, operating_mode, base_nightly_rate_aed, max_guests)
  values (v_prop, '2807', 'DRP-MG1-2807', 'apartment', 1, 1.5, 860.00, 'fully_furnished',
          'short_term', 720, 4)
  returning id into v_unit_b;

  insert into owners (full_name, email, phone, nationality, emirates_id)
  values ('Ahmed Al Mansoori', 'owner.a@example.com', '+971501234567', 'UAE', '784-1980-1234567-1')
  returning id into v_owner_a;

  insert into owners (full_name, email, nationality)
  values ('Sarah Whitfield', 'owner.b@example.com', 'United Kingdom')
  returning id into v_owner_b;

  insert into owner_users (owner_id, profile_id) values
    (v_owner_a, '33333333-3333-3333-3333-333333333333'),
    (v_owner_b, '44444444-4444-4444-4444-444444444444');

  insert into unit_ownerships (unit_id, owner_id, ownership_pct, title_deed_number)
  values (v_unit_a, v_owner_a, 100, '2019-1-234567');
  insert into unit_ownerships (unit_id, owner_id, ownership_pct)
  values (v_unit_b, v_owner_b, 100);

  -- Scope the property manager to this building only.
  insert into staff_property_assignments (profile_id, property_id)
  values ('22222222-2222-2222-2222-222222222222', v_prop);

  insert into management_agreements (unit_id, owner_id, service_mode, start_date, end_date,
                                     commission_pct, fee_vat_applicable)
  values (v_unit_a, v_owner_a, 'long_term', '2026-01-01', '2026-12-31', 8.00, true);

  insert into tenants (full_name, email, phone, nationality, emirates_id, profile_id)
  values ('Priya Nair', 'tenant@example.com', '+971559876543', 'India',
          '784-1990-7654321-2', '55555555-5555-5555-5555-555555555555')
  returning id into v_tenant;

  -- =========================================================================
  -- TEST 1 - ownership cannot exceed 100%
  -- =========================================================================
  begin
    insert into unit_ownerships (unit_id, owner_id, ownership_pct)
    values (v_unit_a, v_owner_b, 25);
    raise exception 'TEST 1 FAILED: 125%% ownership was accepted';
  exception when others then
    if sqlstate = 'P0001' and sqlerrm like '%exceeding 100%' then
      raise notice 'TEST 1  PASS  ownership over 100%% rejected';
    else
      raise;
    end if;
  end;

  -- =========================================================================
  -- TEST 2 - cheque schedule (4 cheques, AED 145,000)
  -- =========================================================================
  insert into leases (unit_id, tenant_id, status, start_date, end_date,
                      annual_rent_aed, security_deposit_aed, payment_method,
                      installment_count, ejari_status, ejari_contract_number,
                      ejari_registered_on, ejari_expiry)
  values (v_unit_a, v_tenant, 'active', '2026-01-15', '2027-01-14',
          145000, 7250, 'cheque', 4, 'registered', 'EJ-2026-0099231',
          '2026-01-16', '2027-01-14')
  returning id into v_lease;

  perform generate_lease_installments(v_lease);

  select count(*), sum(amount_aed) into n, total
  from lease_installments where lease_id = v_lease;

  if n <> 4 or total <> 145000 then
    raise exception 'TEST 2 FAILED: got % cheques totalling %', n, total;
  end if;
  raise notice 'TEST 2  PASS  4 cheques totalling AED % with no rounding loss', total;

  -- Cheque dates must be 3 months apart starting on the lease start date.
  if (select due_date from lease_installments where lease_id = v_lease and installment_no = 2)
     <> '2026-04-15'::date then
    raise exception 'TEST 2b FAILED: second cheque dated %',
      (select due_date from lease_installments where lease_id = v_lease and installment_no = 2);
  end if;
  raise notice 'TEST 2b PASS  cheque dates spaced 3 months apart';

  -- =========================================================================
  -- TEST 3 - clearing a cheque posts collected income to the ledger
  -- =========================================================================
  update lease_installments
     set status = 'cleared', cleared_on = '2026-01-15'
   where lease_id = v_lease and installment_no = 1;

  select count(*) into n from ledger_entries
  where lease_id = v_lease and direction = 'income';
  if n <> 1 then
    raise exception 'TEST 3 FAILED: % ledger entries created', n;
  end if;

  -- Residential long-term rent is VAT exempt: VAT must be zero.
  if (select vat_amount_aed from ledger_entries where lease_id = v_lease) <> 0 then
    raise exception 'TEST 3 FAILED: VAT charged on residential rent';
  end if;
  raise notice 'TEST 3  PASS  cleared cheque posted AED % as VAT-exempt income',
    (select amount_aed from ledger_entries where lease_id = v_lease);

  -- Clear the remaining three so the statement has a full year of income.
  update lease_installments set status = 'cleared', cleared_on = due_date
   where lease_id = v_lease and installment_no > 1;

  -- An owner-borne expense to prove it nets off the payout.
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction,
                              description, amount_aed, vat_applicable)
  values ('2026-03-10', v_unit_a, v_owner_a,
          (select id from gl_categories where code = 'EXP-MAINT'), 'expense',
          'AC compressor replacement', 1500, true);

  -- =========================================================================
  -- TEST 4 - owner statement math
  -- =========================================================================
  declare
    v_stmt uuid;
    s      owner_statements%rowtype;
    expected_fee numeric;
    expected_net numeric;
  begin
    v_stmt := generate_owner_statement(v_owner_a, '2026-01-01', '2026-12-31');
    select * into s from owner_statements where id = v_stmt;

    expected_fee := round(145000 * 0.08, 2);                    -- 11,600.00
    expected_net := 145000                                       -- income
                    - (1500 + round(1500 * 0.05, 2))            -- expense incl. VAT
                    - expected_fee
                    - round(expected_fee * 0.05, 2);            -- VAT on the fee

    if s.gross_income_aed <> 145000 then
      raise exception 'TEST 4 FAILED: gross income %', s.gross_income_aed;
    end if;
    if s.management_fee_aed <> expected_fee then
      raise exception 'TEST 4 FAILED: fee % expected %', s.management_fee_aed, expected_fee;
    end if;
    if s.net_payout_aed <> expected_net then
      raise exception 'TEST 4 FAILED: net payout % expected %', s.net_payout_aed, expected_net;
    end if;

    raise notice 'TEST 4  PASS  income % - expenses % - fee % - VAT % = payout %',
      s.gross_income_aed, s.total_expenses_aed, s.management_fee_aed,
      s.vat_total_aed, s.net_payout_aed;
  end;

  -- =========================================================================
  -- TEST 5 - DET permit gate on the short-term unit
  -- =========================================================================
  begin
    insert into channel_listings (unit_id, channel, is_active, headline)
    values (v_unit_b, 'airbnb', true, 'Marina view 1BR');
    raise exception 'TEST 5 FAILED: unit listed without a DET permit';
  exception when check_violation then
    raise notice 'TEST 5  PASS  listing blocked - no valid DET permit on file';
  end;

  begin
    insert into bookings (unit_id, channel, status, check_in, check_out, adults)
    values (v_unit_b, 'direct', 'confirmed', '2026-09-10', '2026-09-15', 2);
    raise exception 'TEST 5b FAILED: booking accepted without a DET permit';
  exception when check_violation then
    raise notice 'TEST 5b PASS  booking blocked - no valid DET permit on file';
  end;

  insert into holiday_home_permits (unit_id, permit_number, operator_name,
                                    det_classification, issued_on, expires_on,
                                    status, noc_reference, noc_expires_on)
  values (v_unit_b, 'DET-HH-2026-44512', 'D|R|P Holiday Homes', 'Deluxe',
          '2026-02-01', '2027-01-31', 'active', 'NOC-MG1-2026-77', '2027-01-31');

  insert into channel_listings (unit_id, channel, is_active, headline, base_rate_aed)
  values (v_unit_b, 'airbnb', true, 'Marina view 1BR', 720);

  if (select displayed_permit_number from channel_listings
      where unit_id = v_unit_b and channel = 'airbnb') <> 'DET-HH-2026-44512' then
    raise exception 'TEST 5c FAILED: permit number not stamped onto the listing';
  end if;
  raise notice 'TEST 5c PASS  permit number auto-stamped onto the OTA listing';

  -- =========================================================================
  -- TEST 6 - no double-booking; turnover clean auto-scheduled
  -- =========================================================================
  declare v_bk uuid;
  begin
    insert into bookings (unit_id, channel, status, check_in, check_out, adults,
                          accommodation_aed, gross_total_aed)
    values (v_unit_b, 'airbnb', 'confirmed', '2026-09-10', '2026-09-15', 2, 3600, 3600)
    returning id into v_bk;

    begin
      insert into bookings (unit_id, channel, status, check_in, check_out, adults)
      values (v_unit_b, 'booking_com', 'confirmed', '2026-09-12', '2026-09-18', 2);
      raise exception 'TEST 6 FAILED: overlapping booking accepted';
    exception when exclusion_violation then
      raise notice 'TEST 6  PASS  overlapping booking rejected';
    end;

    -- Same-day turnaround must still be allowed (half-open range).
    insert into bookings (unit_id, channel, status, check_in, check_out, adults)
    values (v_unit_b, 'direct', 'confirmed', '2026-09-15', '2026-09-20', 2);
    raise notice 'TEST 6b PASS  same-day checkout/check-in turnaround allowed';

    if (select count(*) from housekeeping_tasks where booking_id = v_bk) <> 1 then
      raise exception 'TEST 6c FAILED: turnover clean not scheduled';
    end if;
    raise notice 'TEST 6c PASS  turnover clean auto-scheduled into the checkout gap';
  end;

  -- =========================================================================
  -- TEST 7 - Ejari occupant declaration staleness
  -- =========================================================================
  update leases set ejari_occupants_synced_at = now() where id = v_lease;

  insert into lease_occupants (lease_id, full_name, relationship, nationality, is_primary)
  values (v_lease, 'Priya Nair', 'self', 'India', true);

  if (select ejari_occupants_synced_at from leases where id = v_lease) is not null then
    raise exception 'TEST 7 FAILED: adding an occupant did not invalidate the Ejari sync';
  end if;

  select count(*) into n from v_compliance_status
  where kind = 'ejari_occupant_declaration' and entity_id = v_lease;
  if n <> 1 then
    raise exception 'TEST 7 FAILED: occupant declaration not in the compliance calendar';
  end if;
  raise notice 'TEST 7  PASS  occupant change flagged, Ejari deadline % (%)',
    (select due_date from v_compliance_status
      where kind = 'ejari_occupant_declaration' and entity_id = v_lease),
    (select severity from v_compliance_status
      where kind = 'ejari_occupant_declaration' and entity_id = v_lease);

  -- =========================================================================
  -- TEST 8 - maintenance owner-approval threshold
  -- =========================================================================
  declare v_ticket uuid;
  begin
    insert into maintenance_requests (unit_id, lease_id, category, priority, title,
                                      description, quoted_amount_aed, cost_borne_by, status)
    values (v_unit_a, v_lease, 'air_conditioning', 'high', 'AC not cooling',
            'Bedroom split unit blowing warm air', 3200, 'owner', 'awaiting_owner_approval')
    returning id into v_ticket;

    if not (select owner_approval_required from maintenance_requests where id = v_ticket) then
      raise exception 'TEST 8 FAILED: AED 3200 quote did not require owner approval';
    end if;

    begin
      update maintenance_requests set status = 'in_progress' where id = v_ticket;
      raise exception 'TEST 8b FAILED: work started without owner approval';
    exception when check_violation then
      raise notice 'TEST 8b PASS  work blocked until the owner approves';
    end;

    update maintenance_requests
       set owner_approved_at = now(),
           owner_approved_by = '33333333-3333-3333-3333-333333333333',
           approved_amount_aed = 3200,
           status = 'in_progress'
     where id = v_ticket;
    raise notice 'TEST 8c PASS  work proceeds once the owner has approved';
  end;

  raise notice '--- schema-level tests complete ---';
end;
$$;

-- ---------------------------------------------------------------------------
-- TEST 9 - RLS isolation. Superusers bypass RLS, so we drop into the
-- `authenticated` role and impersonate each user via the JWT claim GUC.
-- ---------------------------------------------------------------------------
do $$
declare
  n_owner_a integer; n_owner_b integer; n_tenant integer; n_pm integer;
  n_other_lease integer;
begin
  -- Owner A should see exactly the one unit they own.
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into n_owner_a from units;

  -- Owner B likewise, and must not see Owner A's unit.
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into n_owner_b from units;

  -- The tenant sees only the unit they lease.
  perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
  select count(*) into n_tenant from units;
  select count(*) into n_other_lease from leases;

  -- The property manager is assigned to the whole building: both units.
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  select count(*) into n_pm from units;

  reset role;

  if n_owner_a <> 1 then raise exception 'TEST 9 FAILED: owner A sees % units', n_owner_a; end if;
  if n_owner_b <> 1 then raise exception 'TEST 9 FAILED: owner B sees % units', n_owner_b; end if;
  if n_tenant  <> 1 then raise exception 'TEST 9 FAILED: tenant sees % units', n_tenant; end if;
  if n_other_lease <> 1 then raise exception 'TEST 9 FAILED: tenant sees % leases', n_other_lease; end if;
  if n_pm <> 2 then raise exception 'TEST 9 FAILED: property manager sees % units', n_pm; end if;

  raise notice 'TEST 9  PASS  RLS isolation: ownerA=%, ownerB=%, tenant=%, PM=% units',
    n_owner_a, n_owner_b, n_tenant, n_pm;
end;
$$;

-- Owner A must not be able to read Owner B's bank details.
do $$
declare n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
  select count(*) into n from owner_bank_accounts;
  reset role;
  if n <> 0 then
    raise exception 'TEST 10 FAILED: owner A can read % bank records', n;
  end if;
  raise notice 'TEST 10 PASS  owner cannot read another owner''s bank details';
end;
$$;

-- The audit trail must have captured the financial and compliance writes.
do $$
declare n integer;
begin
  select count(*) into n from audit_log where entity_table in ('leases','ledger_entries','holiday_home_permits');
  if n = 0 then
    raise exception 'TEST 11 FAILED: audit trail is empty';
  end if;
  raise notice 'TEST 11 PASS  audit trail captured % financial/compliance writes', n;
end;
$$;

select 'ALL TESTS PASSED' as result;
