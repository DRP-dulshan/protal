-- ============================================================================
-- D|R|P PMS - 0010 Row Level Security
--
-- Principle: every table is deny-by-default. Access is granted by the helper
-- functions in 0009, which resolve a user to the units they may see:
--   staff  -> assigned units (super_admin / finance / marketing: all)
--   owner  -> units they own, via owner_users -> unit_ownerships
--   tenant -> units on their active lease, via tenants.profile_id
--   guest  -> units on their current/recent booking, via guests.profile_id
--
-- The service_role key bypasses RLS entirely and is only ever used by
-- server-side jobs (alerts, statement generation), never by request handlers
-- acting on behalf of a user.
-- ============================================================================

do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','company_settings','communities','properties','units','unit_media',
    'staff_property_assignments','staff_unit_assignments',
    'owners','owner_bank_accounts','owner_users','unit_ownerships','management_agreements',
    'tenants','leases','lease_occupants','lease_installments','deposit_transactions',
    'rent_increase_notices','lease_notices','direct_debit_mandates',
    'holiday_home_permits','channel_listings','pricing_connections','nightly_rates',
    'guests','bookings','booking_guests','availability_blocks','housekeeping_tasks',
    'gl_categories','ledger_entries','invoices','invoice_lines','payments',
    'payment_allocations','service_charge_invoices','owner_statements','owner_statement_lines',
    'vendors','maintenance_requests','maintenance_updates','preventive_maintenance_plans',
    'documents','compliance_alerts','audit_log',
    'leads','lead_activities','viewings','message_templates','messages',
    'service_orders','service_order_items','vehicles','vehicle_bookings'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy profiles_self_read on profiles
  for select to authenticated
  using (id = auth.uid() or pms.is_staff());

create policy profiles_self_update on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from profiles p where p.id = auth.uid()));

create policy profiles_admin_all on profiles
  for all to authenticated
  using (pms.is_admin()) with check (pms.is_admin());

-- ---------------------------------------------------------------------------
-- company_settings : everyone signed in may read branding/VAT rate;
-- only super admin writes.
-- ---------------------------------------------------------------------------
create policy company_settings_read on company_settings
  for select to authenticated using (true);

create policy company_settings_write on company_settings
  for all to authenticated
  using (pms.is_admin()) with check (pms.is_admin());

-- ---------------------------------------------------------------------------
-- Reference data readable by any signed-in user
-- ---------------------------------------------------------------------------
create policy communities_read on communities
  for select to authenticated using (true);
create policy communities_write on communities
  for all to authenticated using (pms.is_manager()) with check (pms.is_manager());

create policy gl_categories_read on gl_categories
  for select to authenticated using (true);
create policy gl_categories_write on gl_categories
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy message_templates_read on message_templates
  for select to authenticated using (pms.is_staff());
create policy message_templates_write on message_templates
  for all to authenticated
  using (pms.my_role() in ('super_admin','property_manager','marketing'))
  with check (pms.my_role() in ('super_admin','property_manager','marketing'));

-- ---------------------------------------------------------------------------
-- properties / units
-- ---------------------------------------------------------------------------
create policy properties_read on properties
  for select to authenticated
  using (pms.can_read_property(id));

create policy properties_write on properties
  for all to authenticated
  using (pms.is_manager()) with check (pms.is_manager());

create policy units_read on units
  for select to authenticated using (pms.can_read_unit(id));

create policy units_write on units
  for all to authenticated
  using (pms.can_write_unit(id)) with check (pms.can_write_unit(id));

create policy unit_media_read on unit_media
  for select to authenticated using (pms.can_read_unit(unit_id));

create policy unit_media_write on unit_media
  for all to authenticated
  using (pms.can_write_unit(unit_id) or pms.my_role() = 'marketing')
  with check (pms.can_write_unit(unit_id) or pms.my_role() = 'marketing');

create policy staff_prop_assign_read on staff_property_assignments
  for select to authenticated using (profile_id = auth.uid() or pms.is_admin());
create policy staff_prop_assign_write on staff_property_assignments
  for all to authenticated using (pms.is_admin()) with check (pms.is_admin());

create policy staff_unit_assign_read on staff_unit_assignments
  for select to authenticated using (profile_id = auth.uid() or pms.is_admin());
create policy staff_unit_assign_write on staff_unit_assignments
  for all to authenticated using (pms.is_admin()) with check (pms.is_admin());

-- ---------------------------------------------------------------------------
-- owners
-- ---------------------------------------------------------------------------
create policy owners_read on owners
  for select to authenticated
  using (
    pms.is_staff()
    or id in (select pms.my_owner_ids())
  );

create policy owners_write on owners
  for all to authenticated
  using (pms.is_manager() or pms.is_finance())
  with check (pms.is_manager() or pms.is_finance());

-- Bank details: finance + super admin only, plus the owner themself.
create policy owner_bank_read on owner_bank_accounts
  for select to authenticated
  using (pms.is_finance() or owner_id in (select pms.my_owner_ids()));

create policy owner_bank_write on owner_bank_accounts
  for all to authenticated
  using (pms.is_finance()) with check (pms.is_finance());

create policy owner_users_read on owner_users
  for select to authenticated
  using (profile_id = auth.uid() or pms.is_staff());
create policy owner_users_write on owner_users
  for all to authenticated using (pms.is_admin()) with check (pms.is_admin());

create policy unit_ownerships_read on unit_ownerships
  for select to authenticated
  using (pms.can_read_unit(unit_id) or owner_id in (select pms.my_owner_ids()));
create policy unit_ownerships_write on unit_ownerships
  for all to authenticated using (pms.is_manager()) with check (pms.is_manager());

create policy mgmt_agreements_read on management_agreements
  for select to authenticated
  using (pms.can_read_unit(unit_id) or owner_id in (select pms.my_owner_ids()));
create policy mgmt_agreements_write on management_agreements
  for all to authenticated
  using (pms.is_manager() or pms.is_finance())
  with check (pms.is_manager() or pms.is_finance());

-- ---------------------------------------------------------------------------
-- tenants / leases
-- ---------------------------------------------------------------------------
create policy tenants_read on tenants
  for select to authenticated
  using (pms.can_read_tenant(id));

create policy tenants_write on tenants
  for all to authenticated
  using (pms.my_role() in ('super_admin','property_manager','agent'))
  with check (pms.my_role() in ('super_admin','property_manager','agent'));

create policy leases_read on leases
  for select to authenticated
  using (pms.can_read_unit(unit_id) or pms.is_my_tenant_record(tenant_id));

create policy leases_write on leases
  for all to authenticated
  using (pms.can_write_unit(unit_id)) with check (pms.can_write_unit(unit_id));

create policy lease_occupants_read on lease_occupants
  for select to authenticated
  using (pms.can_read_lease(lease_id));

-- Tenants may declare their own occupants; this is what keeps Ejari current.
create policy lease_occupants_write on lease_occupants
  for all to authenticated
  using (pms.can_declare_occupants(lease_id))
  with check (pms.can_declare_occupants(lease_id));

create policy lease_installments_read on lease_installments
  for select to authenticated
  using (pms.can_read_lease(lease_id));

create policy lease_installments_write on lease_installments
  for all to authenticated
  using (pms.is_finance() or pms.can_write_lease(lease_id))
  with check (pms.is_finance() or pms.can_write_lease(lease_id));

create policy deposit_txn_read on deposit_transactions
  for select to authenticated
  using (pms.can_read_lease(lease_id));
create policy deposit_txn_write on deposit_transactions
  for all to authenticated
  using (pms.is_finance() or pms.can_write_lease(lease_id))
  with check (pms.is_finance() or pms.can_write_lease(lease_id));

create policy rent_increase_read on rent_increase_notices
  for select to authenticated
  using (pms.can_read_lease(lease_id));
create policy rent_increase_write on rent_increase_notices
  for all to authenticated
  using (pms.can_write_lease(lease_id))
  with check (pms.can_write_lease(lease_id));

create policy lease_notices_read on lease_notices
  for select to authenticated
  using (pms.can_read_lease(lease_id));
create policy lease_notices_write on lease_notices
  for all to authenticated
  using (pms.can_write_lease(lease_id))
  with check (pms.can_write_lease(lease_id));

create policy dd_mandates_read on direct_debit_mandates
  for select to authenticated
  using (pms.is_finance() or pms.can_read_lease(lease_id));
create policy dd_mandates_write on direct_debit_mandates
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

-- ---------------------------------------------------------------------------
-- Short term
-- ---------------------------------------------------------------------------
create policy hh_permits_read on holiday_home_permits
  for select to authenticated using (pms.can_read_unit(unit_id));
create policy hh_permits_write on holiday_home_permits
  for all to authenticated
  using (pms.is_manager()) with check (pms.is_manager());

create policy channel_listings_read on channel_listings
  for select to authenticated using (pms.can_read_unit(unit_id));
create policy channel_listings_write on channel_listings
  for all to authenticated
  using (pms.can_write_unit(unit_id) or pms.my_role() = 'marketing')
  with check (pms.can_write_unit(unit_id) or pms.my_role() = 'marketing');

create policy pricing_connections_read on pricing_connections
  for select to authenticated using (pms.can_read_unit(unit_id));
create policy pricing_connections_write on pricing_connections
  for all to authenticated using (pms.is_manager()) with check (pms.is_manager());

create policy nightly_rates_read on nightly_rates
  for select to authenticated using (pms.can_read_unit(unit_id));
create policy nightly_rates_write on nightly_rates
  for all to authenticated using (pms.can_write_unit(unit_id)) with check (pms.can_write_unit(unit_id));

create policy guests_read on guests
  for select to authenticated
  using (pms.can_read_guest(id));
create policy guests_write on guests
  for all to authenticated
  using (pms.my_role() in ('super_admin','property_manager','agent'))
  with check (pms.my_role() in ('super_admin','property_manager','agent'));

create policy bookings_read on bookings
  for select to authenticated
  using (pms.can_read_unit(unit_id) or pms.is_my_guest_record(guest_id));
create policy bookings_write on bookings
  for all to authenticated
  using (pms.can_write_unit(unit_id)) with check (pms.can_write_unit(unit_id));

create policy booking_guests_read on booking_guests
  for select to authenticated
  using (pms.can_read_booking(booking_id));
-- The guest fills in their own registration form.
create policy booking_guests_write on booking_guests
  for all to authenticated
  using (pms.can_register_booking_guests(booking_id))
  with check (pms.can_register_booking_guests(booking_id));

create policy availability_blocks_read on availability_blocks
  for select to authenticated using (pms.can_read_unit(unit_id));
create policy availability_blocks_write on availability_blocks
  for all to authenticated using (pms.can_write_unit(unit_id)) with check (pms.can_write_unit(unit_id));

-- Housekeeping staff see their own queue plus anything on their assigned units.
create policy housekeeping_read on housekeeping_tasks
  for select to authenticated
  using (assigned_to = auth.uid() or pms.can_read_unit(unit_id));
create policy housekeeping_write on housekeeping_tasks
  for all to authenticated
  using (assigned_to = auth.uid() or pms.can_write_unit(unit_id))
  with check (assigned_to = auth.uid() or pms.can_write_unit(unit_id));

-- ---------------------------------------------------------------------------
-- Finance. Owners see their own numbers; tenants and guests see none of it
-- except the invoices addressed to them.
-- ---------------------------------------------------------------------------
create policy ledger_read on ledger_entries
  for select to authenticated
  using (
    pms.is_finance()
    or (unit_id is not null and pms.staff_scoped_to_unit(unit_id))
    or (is_owner_visible and owner_id in (select pms.my_owner_ids()))
  );
create policy ledger_write on ledger_entries
  for all to authenticated
  using (pms.is_finance() or (unit_id is not null and pms.can_write_unit(unit_id)))
  with check (pms.is_finance() or (unit_id is not null and pms.can_write_unit(unit_id)));

create policy invoices_read on invoices
  for select to authenticated
  using (
    pms.is_finance()
    or (unit_id is not null and pms.staff_scoped_to_unit(unit_id))
    or (party_kind = 'owner'  and party_id in (select pms.my_owner_ids()))
    or (party_kind = 'tenant' and pms.is_my_tenant_record(party_id))
    or (party_kind = 'guest'  and pms.is_my_guest_record(party_id))
  );
create policy invoices_write on invoices
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy invoice_lines_read on invoice_lines
  for select to authenticated
  using (exists (select 1 from invoices i where i.id = invoice_lines.invoice_id));
create policy invoice_lines_write on invoice_lines
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy payments_read on payments
  for select to authenticated
  using (
    pms.is_finance()
    or (unit_id is not null and pms.staff_scoped_to_unit(unit_id))
    or (party_kind = 'owner' and party_id in (select pms.my_owner_ids()))
  );
create policy payments_write on payments
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy payment_allocations_read on payment_allocations
  for select to authenticated
  using (exists (select 1 from payments p where p.id = payment_allocations.payment_id));
create policy payment_allocations_write on payment_allocations
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy service_charges_read on service_charge_invoices
  for select to authenticated using (pms.is_finance() or pms.can_read_unit(unit_id));
create policy service_charges_write on service_charge_invoices
  for all to authenticated
  using (pms.is_finance() or pms.can_write_unit(unit_id))
  with check (pms.is_finance() or pms.can_write_unit(unit_id));

create policy owner_statements_read on owner_statements
  for select to authenticated
  using (
    pms.is_finance()
    or pms.is_manager()
    or (status in ('issued','approved','paid') and owner_id in (select pms.my_owner_ids()))
  );
create policy owner_statements_write on owner_statements
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

create policy owner_statement_lines_read on owner_statement_lines
  for select to authenticated
  using (exists (select 1 from owner_statements s where s.id = owner_statement_lines.statement_id));
create policy owner_statement_lines_write on owner_statement_lines
  for all to authenticated using (pms.is_finance()) with check (pms.is_finance());

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
create policy vendors_read on vendors
  for select to authenticated using (pms.is_staff());
create policy vendors_write on vendors
  for all to authenticated
  using (pms.is_manager() or pms.my_role() = 'maintenance')
  with check (pms.is_manager() or pms.my_role() = 'maintenance');

create policy maintenance_read on maintenance_requests
  for select to authenticated
  using (
    raised_by = auth.uid()
    or assigned_to = auth.uid()
    or pms.can_read_unit(unit_id)
  );

-- Tenants and guests raise tickets on their own unit; staff manage them.
create policy maintenance_insert on maintenance_requests
  for insert to authenticated
  with check (pms.can_read_unit(unit_id));

create policy maintenance_update on maintenance_requests
  for update to authenticated
  using (
    assigned_to = auth.uid()
    or pms.can_write_unit(unit_id)
    or (owner_approval_required and pms.owns_unit(unit_id))
  )
  with check (
    assigned_to = auth.uid()
    or pms.can_write_unit(unit_id)
    or (owner_approval_required and pms.owns_unit(unit_id))
  );

create policy maintenance_delete on maintenance_requests
  for delete to authenticated using (pms.is_manager());

create policy maintenance_updates_read on maintenance_updates
  for select to authenticated
  using (
    exists (select 1 from maintenance_requests r where r.id = maintenance_updates.request_id)
    and (not is_internal or pms.is_staff())
  );
create policy maintenance_updates_write on maintenance_updates
  for all to authenticated
  using (exists (select 1 from maintenance_requests r where r.id = maintenance_updates.request_id))
  with check (exists (select 1 from maintenance_requests r where r.id = maintenance_updates.request_id));

create policy pm_plans_read on preventive_maintenance_plans
  for select to authenticated
  using (
    (unit_id is not null and pms.can_read_unit(unit_id))
    or (property_id is not null and pms.is_staff())
  );
create policy pm_plans_write on preventive_maintenance_plans
  for all to authenticated
  using (pms.is_manager() or pms.my_role() = 'maintenance')
  with check (pms.is_manager() or pms.my_role() = 'maintenance');

-- ---------------------------------------------------------------------------
-- Documents. Sensitive files (ID copies, bank letters) are staff-only unless
-- the requester is the party the document belongs to.
-- ---------------------------------------------------------------------------
create policy documents_read on documents
  for select to authenticated
  using (
    case
      when is_sensitive then
        pms.my_role() in ('super_admin','property_manager','finance')
        or (owner_id is not null and owner_id in (select pms.my_owner_ids()))
      else
        (unit_id is not null and pms.can_read_unit(unit_id))
        or (owner_id is not null and owner_id in (select pms.my_owner_ids()))
        or (entity_kind = 'company' and pms.is_staff())
        or uploaded_by = auth.uid()
    end
    and (
      pms.is_staff()
      or (is_owner_visible and owner_id in (select pms.my_owner_ids()))
      or (is_tenant_visible and unit_id is not null and (pms.tenants_unit(unit_id) or pms.stays_in_unit(unit_id)))
      or uploaded_by = auth.uid()
    )
  );

create policy documents_insert on documents
  for insert to authenticated
  with check (
    pms.is_staff()
    or (unit_id is not null and pms.can_read_unit(unit_id))
  );

create policy documents_update on documents
  for update to authenticated
  using (pms.is_manager() or uploaded_by = auth.uid())
  with check (pms.is_manager() or uploaded_by = auth.uid());

create policy documents_delete on documents
  for delete to authenticated using (pms.is_admin());

create policy compliance_alerts_read on compliance_alerts
  for select to authenticated
  using (
    pms.is_staff()
    or (unit_id is not null and pms.can_read_unit(unit_id))
    or owner_id in (select pms.my_owner_ids())
  );
create policy compliance_alerts_write on compliance_alerts
  for all to authenticated using (pms.is_staff()) with check (pms.is_staff());

-- Audit log is append-only and readable by super admin + finance only.
create policy audit_read on audit_log
  for select to authenticated using (pms.is_admin() or pms.is_finance());
-- No insert/update/delete policy: only SECURITY DEFINER triggers write here.

-- ---------------------------------------------------------------------------
-- CRM / comms / add-ons
-- ---------------------------------------------------------------------------
create policy leads_read on leads
  for select to authenticated
  using (pms.is_staff() and (assigned_to = auth.uid() or pms.my_role() in ('super_admin','property_manager','marketing')));
create policy leads_write on leads
  for all to authenticated
  using (pms.my_role() in ('super_admin','property_manager','agent','marketing'))
  with check (pms.my_role() in ('super_admin','property_manager','agent','marketing'));

create policy lead_activities_read on lead_activities
  for select to authenticated using (exists (select 1 from leads l where l.id = lead_activities.lead_id));
create policy lead_activities_write on lead_activities
  for all to authenticated using (pms.is_staff()) with check (pms.is_staff());

create policy viewings_read on viewings
  for select to authenticated using (agent_id = auth.uid() or pms.can_read_unit(unit_id));
create policy viewings_write on viewings
  for all to authenticated
  using (agent_id = auth.uid() or pms.can_write_unit(unit_id))
  with check (agent_id = auth.uid() or pms.can_write_unit(unit_id));

create policy messages_read on messages
  for select to authenticated
  using (
    pms.is_staff()
    or (party_kind = 'owner'  and party_id in (select pms.my_owner_ids()))
    or (party_kind = 'tenant' and pms.is_my_tenant_record(party_id))
    or (party_kind = 'guest'  and pms.is_my_guest_record(party_id))
  );
create policy messages_write on messages
  for all to authenticated using (pms.is_staff()) with check (pms.is_staff());

create policy service_orders_read on service_orders
  for select to authenticated
  using (pms.can_read_unit(unit_id) or owner_id in (select pms.my_owner_ids()));
create policy service_orders_write on service_orders
  for all to authenticated
  using (pms.can_write_unit(unit_id) or pms.is_finance())
  with check (pms.can_write_unit(unit_id) or pms.is_finance());

create policy service_order_items_read on service_order_items
  for select to authenticated
  using (exists (select 1 from service_orders o where o.id = service_order_items.order_id));
create policy service_order_items_write on service_order_items
  for all to authenticated using (pms.is_staff()) with check (pms.is_staff());

create policy vehicles_read on vehicles
  for select to authenticated using (pms.is_staff());
create policy vehicles_write on vehicles
  for all to authenticated using (pms.is_manager()) with check (pms.is_manager());

create policy vehicle_bookings_read on vehicle_bookings
  for select to authenticated using (pms.is_staff());
create policy vehicle_bookings_write on vehicle_bookings
  for all to authenticated using (pms.is_staff()) with check (pms.is_staff());
