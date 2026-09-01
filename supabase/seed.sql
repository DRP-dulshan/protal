-- ============================================================================
-- D|R|P PMS - demo seed
--
-- A small but realistic Dubai portfolio: two communities, three buildings, a
-- villa, long-term tenancies with cheque schedules, a licensed holiday home,
-- owner statements and a compliance backlog that is deliberately imperfect so
-- the dashboards have something to show.
--
-- Business data only. Auth users are created in Supabase → Authentication,
-- then linked at the end of this file (see LINKING PORTAL LOGINS).
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed.sql
-- ============================================================================

set client_min_messages = warning;

do $$
declare
  -- communities / properties
  c_marina uuid; c_downtown uuid; c_arabian uuid;
  p_gate uuid; p_opera uuid; p_villa uuid;
  -- units
  u_1204 uuid; u_2807 uuid; u_3312 uuid; u_villa uuid; u_505 uuid;
  -- owners
  o_ahmed uuid; o_sarah uuid; o_horizon uuid;
  -- tenants
  t_priya uuid; t_marco uuid;
  -- leases
  l_1204 uuid; l_3312 uuid;
  -- misc
  v_vendor uuid; v_guest uuid; v_booking uuid; v_stmt uuid;
  cat_maint uuid; cat_dewa uuid; cat_booking uuid; cat_channel uuid; cat_service uuid;
begin
  if exists (select 1 from properties limit 1) then
    raise notice 'Data already present - seed skipped.';
    return;
  end if;

  select id into cat_maint   from gl_categories where code = 'EXP-MAINT';
  select id into cat_dewa    from gl_categories where code = 'EXP-DEWA';
  select id into cat_booking from gl_categories where code = 'INC-BOOKING';
  select id into cat_channel from gl_categories where code = 'EXP-CHANNEL';
  select id into cat_service from gl_categories where code = 'EXP-SERVICE-CHG';

  -- =========================================================================
  -- Communities and properties
  -- =========================================================================
  insert into communities (name, emirate, city, dld_community_number)
  values ('Dubai Marina', 'dubai', 'Dubai', '392')
  returning id into c_marina;

  insert into communities (name, emirate, city, dld_community_number)
  values ('Downtown Dubai', 'dubai', 'Dubai', '345')
  returning id into c_downtown;

  insert into communities (name, emirate, city, dld_community_number)
  values ('Arabian Ranches', 'dubai', 'Dubai', '681')
  returning id into c_arabian;

  insert into properties (community_id, name, kind, developer_name, floors,
                          total_units, owners_association_name, mollak_property_id,
                          amenities)
  values (c_marina, 'Marina Gate 1', 'building', 'Select Group', 64, 428,
          'Marina Gate Owners Association', 'MOL-DXB-99231',
          '{Gym,Pool,Sauna,Concierge,Covered parking}')
  returning id into p_gate;

  insert into properties (community_id, name, kind, developer_name, floors,
                          total_units, owners_association_name, mollak_property_id,
                          amenities)
  values (c_downtown, 'Opera Grand', 'building', 'Emaar Properties', 66, 265,
          'Opera Grand OA', 'MOL-DXB-77104',
          '{Gym,Pool,Kids play area,Valet}')
  returning id into p_opera;

  insert into properties (community_id, name, kind, developer_name, amenities)
  values (c_arabian, 'Palmera 3', 'villa_compound', 'Emaar Properties',
          '{Community pool,Park,Tennis court}')
  returning id into p_villa;

  -- =========================================================================
  -- Units
  -- =========================================================================
  insert into units (property_id, unit_number, reference_code, kind, floor,
                     bedrooms, bathrooms, size_sqft, furnishing, parking_spaces,
                     parking_numbers, balcony, view_description,
                     dewa_premise_number, title_deed_number, makani_number,
                     mollak_unit_id, operating_mode, status, target_annual_rent_aed)
  values (p_gate, '1204', 'DRP-MG1-1204', 'apartment', '12', 2, 2, 1240.50,
          'fully_furnished', 1, '{P2-114}', true, 'Marina and sea view',
          '3610234567', '2019-1-234567', '2648770179', 'MOL-U-11204',
          'long_term', 'occupied_long_term', 145000)
  returning id into u_1204;

  insert into units (property_id, unit_number, reference_code, kind, floor,
                     bedrooms, bathrooms, size_sqft, furnishing, parking_spaces,
                     balcony, view_description, dewa_premise_number,
                     operating_mode, status, base_nightly_rate_aed, min_nights,
                     max_guests)
  values (p_gate, '2807', 'DRP-MG1-2807', 'apartment', '28', 1, 1.5, 860.00,
          'fully_furnished', 1, true, 'Full marina view', '3610299881',
          'short_term', 'listed_short_term', 720, 2, 4)
  returning id into u_2807;

  insert into units (property_id, unit_number, reference_code, kind, floor,
                     bedrooms, bathrooms, size_sqft, furnishing, parking_spaces,
                     balcony, view_description, dewa_premise_number,
                     title_deed_number, operating_mode, status,
                     target_annual_rent_aed)
  values (p_opera, '3312', 'DRP-OG-3312', 'apartment', '33', 3, 4, 2145.00,
          'semi_furnished', 2, true, 'Burj Khalifa and fountain view',
          '3620145522', '2021-1-889120', 'long_term', 'occupied_long_term', 320000)
  returning id into u_3312;

  insert into units (property_id, unit_number, reference_code, kind,
                     bedrooms, bathrooms, size_sqft, furnishing, parking_spaces,
                     dewa_premise_number, title_deed_number, operating_mode,
                     status, target_annual_rent_aed)
  values (p_villa, 'PAL3-42', 'DRP-AR-P342', 'villa', 4, 5, 3400.00,
          'unfurnished', 2, '3630778812', '2017-2-445120', 'long_term',
          'vacant', 285000)
  returning id into u_villa;

  insert into units (property_id, unit_number, reference_code, kind, floor,
                     bedrooms, bathrooms, size_sqft, furnishing, parking_spaces,
                     operating_mode, status, base_nightly_rate_aed, max_guests,
                     target_annual_rent_aed)
  values (p_opera, '505', 'DRP-OG-0505', 'apartment', '5', 2, 2, 1310.00,
          'fully_furnished', 1, 'both', 'vacant', 950, 4, 210000)
  returning id into u_505;

  -- =========================================================================
  -- Owners
  -- =========================================================================
  insert into owners (full_name, email, phone, whatsapp, nationality, emirates_id,
                      emirates_id_expiry, address_line, country_of_residence,
                      preferred_channel)
  values ('Ahmed Al Mansoori', 'ahmed.almansoori@example.ae', '+971501234567',
          '+971501234567', 'United Arab Emirates', '784-1980-1234567-1',
          '2027-04-30', 'Villa 12, Al Barsha 2, Dubai', 'United Arab Emirates',
          'whatsapp')
  returning id into o_ahmed;

  insert into owners (full_name, email, phone, nationality, passport_number,
                      passport_expiry, address_line, country_of_residence,
                      preferred_channel)
  values ('Sarah Whitfield', 'sarah.whitfield@example.com', '+447700900123',
          'United Kingdom', '563812994', '2029-11-02',
          '18 Cambridge Gardens, London', 'United Kingdom', 'email')
  returning id into o_sarah;

  insert into owners (is_company, full_name, company_trade_licence, email, phone,
                      trn, address_line, country_of_residence)
  values (true, 'Horizon Capital Investments LLC', 'CN-2891044',
          'assets@horizoncapital.example', '+97144567890', '100234567800003',
          'Office 1802, Boulevard Plaza Tower 1, Downtown Dubai',
          'United Arab Emirates')
  returning id into o_horizon;

  insert into owner_bank_accounts (owner_id, account_holder, bank_name, iban, swift_bic)
  values
    (o_ahmed, 'Ahmed Al Mansoori', 'Emirates NBD', 'AE070331234567890123456', 'EBILAEAD'),
    (o_sarah, 'S Whitfield', 'HSBC Middle East', 'AE460260001015079260101', 'BBMEAEAD'),
    (o_horizon, 'Horizon Capital Investments LLC', 'Mashreq Bank',
     'AE180330000019100000000', 'BOMLAEAD');

  insert into unit_ownerships (unit_id, owner_id, ownership_pct, title_deed_number, purchase_date)
  values
    (u_1204, o_ahmed,   100, '2019-1-234567', '2019-03-14'),
    (u_2807, o_ahmed,   100, '2020-1-118902', '2020-08-01'),
    (u_3312, o_horizon, 100, '2021-1-889120', '2021-06-22'),
    (u_505,  o_horizon, 100, '2022-1-440118', '2022-02-10'),
    (u_villa, o_sarah,  100, '2017-2-445120', '2017-09-05');

  -- =========================================================================
  -- Management agreements
  -- =========================================================================
  insert into management_agreements (unit_id, owner_id, service_mode, start_date,
                                     end_date, commission_pct, leasing_commission_pct,
                                     auto_renew)
  values
    (u_1204, o_ahmed,   'long_term',  '2026-01-01', '2026-12-31',  8.00, 5.00, true),
    (u_2807, o_ahmed,   'short_term', '2026-01-01', '2026-12-31', 20.00, null, true),
    (u_3312, o_horizon, 'long_term',  '2026-02-01', '2027-01-31',  7.00, 5.00, true),
    (u_505,  o_horizon, 'both',       '2026-02-01', '2027-01-31', 15.00, null, true),
    -- Deliberately close to expiry so it shows on the compliance calendar.
    (u_villa, o_sarah,  'long_term',  '2025-10-01', current_date + 24, 8.00, 5.00, false);

  -- =========================================================================
  -- Tenants and tenancies
  -- =========================================================================
  insert into tenants (full_name, email, phone, whatsapp, nationality, emirates_id,
                       emirates_id_expiry, employer, occupation)
  values ('Priya Nair', 'priya.nair@example.com', '+971559876543', '+971559876543',
          'India', '784-1990-7654321-2', '2027-01-18', 'Emirates Airline',
          'Senior Cabin Crew')
  returning id into t_priya;

  insert into tenants (is_company, full_name, company_trade_licence, email, phone,
                       nationality, trn)
  values (true, 'Vantage Consulting FZ-LLC', 'FZ-LLC-77120',
          'admin@vantage.example', '+97145559000', 'United Arab Emirates',
          '100987654300003')
  returning id into t_marco;

  insert into leases (unit_id, tenant_id, status, start_date, end_date,
                      annual_rent_aed, security_deposit_aed, payment_method,
                      installment_count, ejari_status, ejari_contract_number,
                      ejari_registered_on, ejari_expiry, agency_fee_aed,
                      ejari_fee_aed, move_in_date)
  values (u_1204, t_priya, 'active', '2026-01-15', '2027-01-14', 145000, 7250,
          'cheque', 4, 'registered', 'EJ-2026-0099231', '2026-01-16',
          '2027-01-14', 7250, 220, '2026-01-15')
  returning id into l_1204;

  -- Expires soon, so the renewal notice window is open on the dashboard.
  insert into leases (unit_id, tenant_id, status, start_date, end_date,
                      annual_rent_aed, security_deposit_aed, payment_method,
                      installment_count, ejari_status, ejari_contract_number,
                      ejari_registered_on, ejari_expiry, agency_fee_aed)
  values (u_3312, t_marco, 'active', current_date - 305, current_date + 60,
          320000, 32000, 'cheque', 2, 'registered', 'EJ-2025-0077410',
          current_date - 303, current_date + 60, 16000)
  returning id into l_3312;

  perform generate_lease_installments(l_1204);
  perform generate_lease_installments(l_3312);

  -- Two cheques cleared on the Marina tenancy, one bounced and re-presented.
  update lease_installments
     set status = 'cleared', cleared_on = due_date, presented_on = due_date,
         amount_paid_aed = amount_aed,
         cheque_number = 'CHQ-' || lpad((100450 + installment_no)::text, 6, '0'),
         cheque_bank = 'Emirates NBD'
   where lease_id = l_1204 and installment_no <= 2;

  update lease_installments
     set cheque_number = 'CHQ-' || lpad((100450 + installment_no)::text, 6, '0'),
         cheque_bank = 'Emirates NBD'
   where lease_id = l_1204 and installment_no > 2;

  update lease_installments
     set status = 'bounced', presented_on = due_date, bounced_on = due_date + 2,
         bounce_reason = 'Insufficient funds', bounce_charge_aed = 250
   where lease_id = l_1204 and installment_no = 3;

  update lease_installments
     set status = 'cleared', cleared_on = due_date, presented_on = due_date,
         amount_paid_aed = amount_aed, cheque_bank = 'Mashreq Bank'
   where lease_id = l_3312 and installment_no = 1;

  insert into deposit_transactions (lease_id, kind, amount_aed, occurred_on)
  values (l_1204, 'collected', 7250, '2026-01-15');

  update leases set deposit_status = 'held' where id in (l_1204, l_3312);

  -- Declared occupants. The Marina tenancy is filed with Ejari; the Downtown
  -- one is not, so it shows as a live compliance breach.
  insert into lease_occupants (lease_id, full_name, relationship, nationality,
                               emirates_id, is_primary, ejari_synced_at)
  values
    (l_1204, 'Priya Nair', 'self', 'India', '784-1990-7654321-2', true, now()),
    (l_1204, 'Arjun Nair', 'spouse', 'India', '784-1988-3312445-6', false, now());

  update leases set ejari_occupants_synced_at = now() where id = l_1204;

  insert into lease_occupants (lease_id, full_name, relationship, nationality, is_primary)
  values (l_3312, 'Marco Bianchi', 'company representative', 'Italy', true);

  -- =========================================================================
  -- Holiday home: permit, listings, a booking
  -- =========================================================================
  insert into holiday_home_permits (unit_id, permit_number, operator_name,
                                    operator_licence_number, det_classification,
                                    issued_on, expires_on, status, noc_reference,
                                    noc_expires_on)
  values (u_2807, 'DET-HH-2026-44512', 'D|R|P Holiday Homes', 'HH-OP-11209',
          'Deluxe', current_date - 320, current_date + 45, 'active',
          'NOC-MG1-2026-77', current_date + 45);

  insert into channel_listings (unit_id, channel, external_listing_id, is_active,
                               headline, base_rate_aed, min_nights,
                               cleaning_fee_aed, channel_commission_pct)
  values
    (u_2807, 'airbnb', 'AB-88192043', true,
     'Marina view 1BR with balcony · Marina Gate', 720, 2, 180, 15.00),
    (u_2807, 'booking_com', 'BC-2299104', true,
     'Marina Gate 1BR · high floor', 745, 2, 180, 18.00);

  insert into guests (full_name, email, phone, nationality, passport_number,
                      passport_expiry)
  values ('Elena Sokolova', 'elena.s@example.com', '+79161234567', 'Russia',
          '757201881', '2030-03-19')
  returning id into v_guest;

  insert into bookings (unit_id, guest_id, channel, external_booking_id, status,
                        check_in, check_out, adults, children, nightly_rate_aed,
                        accommodation_aed, cleaning_fee_aed, tourism_dirham_aed,
                        channel_commission_aed, gross_total_aed, damage_deposit_aed,
                        quoted_currency, fx_rate_to_aed)
  values (u_2807, v_guest, 'airbnb', 'HMABC12345', 'checked_out',
          current_date - 12, current_date - 5, 2, 0, 720, 5040, 180, 140,
          756, 5360, 1000, 'EUR', 3.95)
  returning id into v_booking;

  insert into booking_guests (booking_id, guest_id, full_name, nationality,
                              passport_number, is_lead_guest, registered_at)
  values (v_booking, v_guest, 'Elena Sokolova', 'Russia', '757201881', true,
          now() - interval '12 days');

  -- Short-stay revenue and the costs that come with it.
  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction,
                              description, amount_aed, vat_applicable, booking_id)
  values
    (current_date - 5, u_2807, o_ahmed, cat_booking, 'income',
     'Booking ' || (select booking_number from bookings where id = v_booking) ||
     ' - 7 nights', 5220, true, v_booking),
    (current_date - 5, u_2807, o_ahmed, cat_channel, 'expense',
     'Airbnb channel commission', 756, false, v_booking);

  -- =========================================================================
  -- Operating costs
  -- =========================================================================
  insert into vendors (name, categories, contact_name, phone, email,
                       trade_licence_number, callout_fee_aed, rating, is_approved)
  values ('CoolAir Technical Services LLC',
          '{air_conditioning,electrical,plumbing}', 'Rajesh Kumar',
          '+971552341190', 'ops@coolair.example', 'CN-1120934', 150, 4.5, true)
  returning id into v_vendor;

  insert into ledger_entries (entry_date, unit_id, owner_id, category_id, direction,
                              description, amount_aed, vat_applicable)
  values
    (current_date - 40, u_1204, o_ahmed, cat_maint, 'expense',
     'AC compressor replacement - master bedroom', 1500, true),
    (current_date - 25, u_1204, o_ahmed, cat_dewa, 'expense',
     'DEWA - common area recharge', 340, false),
    (current_date - 18, u_3312, o_horizon, cat_service, 'expense',
     'Mollak service charge Q1 2026', 12870, true);

  insert into service_charge_invoices (unit_id, mollak_invoice_number, oa_name,
                                       management_company, period_start, period_end,
                                       amount_aed, vat_aed, rate_per_sqft_aed,
                                       due_date, status)
  values (u_3312, 'MOL-INV-2026-004412', 'Opera Grand OA', 'Emaar Community Management',
          '2026-01-01', '2026-03-31', 12870, 643.50, 24.00,
          current_date + 10, 'issued');

  -- Maintenance: one closed, one waiting on the owner.
  insert into maintenance_requests (unit_id, lease_id, category, priority, status,
                                    title, description, vendor_id, quoted_amount_aed,
                                    approved_amount_aed, final_amount_aed,
                                    cost_borne_by, owner_approved_at,
                                    completed_at, closed_at, resolution_notes,
                                    reported_at)
  values (u_1204, l_1204, 'air_conditioning', 'high', 'closed',
          'AC not cooling in master bedroom',
          'Unit blowing warm air, tenant reports no cooling since Tuesday.',
          v_vendor, 1500, 1500, 1500, 'owner', now() - interval '41 days',
          now() - interval '38 days', now() - interval '37 days',
          'Compressor replaced, gas recharged, 6 month warranty.',
          now() - interval '43 days');

  insert into maintenance_requests (unit_id, lease_id, category, priority, status,
                                    title, description, vendor_id,
                                    quoted_amount_aed, cost_borne_by, reported_at)
  values (u_3312, l_3312, 'plumbing', 'medium', 'awaiting_owner_approval',
          'Guest bathroom leak under vanity',
          'Slow leak from the mixer supply line, cabinet base is swelling.',
          v_vendor, 2400, 'owner', now() - interval '3 days');

  -- =========================================================================
  -- Preventive maintenance and compliance documents
  -- =========================================================================
  insert into preventive_maintenance_plans (unit_id, category, title,
                                            frequency_months, vendor_id,
                                            estimated_cost_aed, last_completed_on,
                                            next_due_on)
  values
    (u_1204, 'air_conditioning', 'AC service and filter clean', 6, v_vendor, 450,
     current_date - 170, current_date + 12),
    (u_3312, 'pest_control', 'Quarterly pest control', 3, v_vendor, 300,
     current_date - 85, current_date + 5);

  insert into documents (kind, entity_kind, entity_id, unit_id, owner_id, title,
                         storage_path, file_name, mime_type, reference_number,
                         issued_on, expires_on, is_sensitive)
  values
    ('title_deed', 'unit', u_1204, u_1204, o_ahmed, 'Title Deed - Marina Gate 1204',
     'unit/' || u_1204 || '/title-deed.pdf', 'title-deed.pdf', 'application/pdf',
     '2019-1-234567', '2019-03-14', null, false),
    ('ejari_certificate', 'lease', l_1204, u_1204, o_ahmed,
     'Ejari certificate 2026', 'lease/' || l_1204 || '/ejari.pdf', 'ejari.pdf',
     'application/pdf', 'EJ-2026-0099231', '2026-01-16', '2027-01-14', false),
    ('det_permit', 'unit', u_2807, u_2807, o_ahmed, 'DET holiday home permit',
     'unit/' || u_2807 || '/det-permit.pdf', 'det-permit.pdf', 'application/pdf',
     'DET-HH-2026-44512', current_date - 320, current_date + 45, false),
    ('insurance_policy', 'property', p_gate, u_1204, o_ahmed,
     'Contents insurance - Marina Gate 1204',
     'unit/' || u_1204 || '/insurance.pdf', 'insurance.pdf', 'application/pdf',
     'POL-8891042', current_date - 350, current_date + 15, false),
    ('emirates_id', 'owner', o_ahmed, null, o_ahmed, 'Emirates ID - Ahmed Al Mansoori',
     'owner/' || o_ahmed || '/eid.pdf', 'eid.pdf', 'application/pdf',
     '784-1980-1234567-1', '2022-05-01', '2027-04-30', true);

  -- =========================================================================
  -- Interior design tie-in and an owner statement
  -- =========================================================================
  insert into service_orders (kind, status, unit_id, owner_id, title, brief,
                              quoted_amount_aed, approved_amount_aed,
                              vat_applicable, quoted_at, approved_at)
  values ('furnishing', 'approved', u_villa, o_sarah,
          'Full furnishing package - Palmera 3 villa',
          '4-bedroom villa, contemporary package, 6 week lead time.',
          185000, 185000, true, now() - interval '20 days',
          now() - interval '12 days');

  -- Year-to-date rather than last month, so the demo statement actually spans
  -- the seeded rent cheques and booking revenue. Statements are normally run
  -- monthly; the function takes any period.
  v_stmt := generate_owner_statement(
    o_ahmed,
    date_trunc('year', current_date)::date,
    current_date
  );
  update owner_statements
     set status = 'issued', issued_on = current_date - 3
   where id = v_stmt;

  insert into message_templates (code, channel, name, category, body, variables)
  values
    ('rent_due', 'whatsapp', 'Rent due reminder', 'leasing',
     'Hello {tenant_name}, a reminder that your rent cheque of AED {amount} for {unit} is due on {due_date}. D|R|P Property Management.',
     '{tenant_name,amount,unit,due_date}'),
    ('ejari_renewal', 'whatsapp', 'Ejari renewal notice', 'compliance',
     'Hello {tenant_name}, the Ejari registration for {unit} expires on {expiry_date}. We will contact you shortly to arrange renewal.',
     '{tenant_name,unit,expiry_date}'),
    ('permit_expiry', 'email', 'DET permit expiry warning', 'compliance',
     'The DET holiday home permit {permit_number} for {unit} expires on {expiry_date}. Renewal must be submitted to avoid the listing being suspended.',
     '{permit_number,unit,expiry_date}'),
    ('guest_checkin', 'whatsapp', 'Guest check-in instructions', 'holiday_homes',
     'Welcome {guest_name}. Check-in for {unit} is from {check_in_time}. Building: {building}. Access code: {access_code}. DET permit {permit_number}.',
     '{guest_name,unit,check_in_time,building,access_code,permit_number}'),
    ('statement_issued', 'email', 'Owner statement issued', 'finance',
     'Dear {owner_name}, your statement for {period} is available in your portal. Net payable: AED {net_payout}.',
     '{owner_name,period,net_payout}')
  on conflict do nothing;

  raise notice 'Seed complete: 3 communities, 3 properties, 5 units, 3 owners, 2 tenancies, 1 permit, 1 booking.';
end;
$$;

-- ============================================================================
-- LINKING PORTAL LOGINS
--
-- Create the users in Supabase → Authentication → Users, then run the block
-- below with their email addresses. The handle_new_user trigger will already
-- have created a profiles row for each.
-- ============================================================================
--
--   update profiles set role = 'super_admin',      full_name = 'Admin User'
--     where email = 'admin@drp.ae';
--   update profiles set role = 'property_manager', full_name = 'Property Manager'
--     where email = 'pm@drp.ae';
--   update profiles set role = 'finance',          full_name = 'Accountant'
--     where email = 'finance@drp.ae';
--   update profiles set role = 'owner'  where email = 'ahmed.almansoori@example.ae';
--   update profiles set role = 'tenant' where email = 'priya.nair@example.com';
--
--   -- Give the owner portal access to their owner record
--   insert into owner_users (owner_id, profile_id)
--   select o.id, p.id from owners o, profiles p
--   where o.email = 'ahmed.almansoori@example.ae'
--     and p.email = 'ahmed.almansoori@example.ae';
--
--   -- Give the tenant portal access to their tenancy
--   update tenants set profile_id = (select id from profiles where email = 'priya.nair@example.com')
--   where email = 'priya.nair@example.com';
--
--   -- Scope the property manager. Without an assignment they see nothing:
--   -- staff access is deny-by-default.
--   insert into staff_property_assignments (profile_id, property_id)
--   select p.id, pr.id from profiles p cross join properties pr
--   where p.email = 'pm@drp.ae';
