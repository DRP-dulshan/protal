-- ============================================================================
-- D|R|P PMS - 0009 Access helper functions + reporting views
--
-- The helpers are SECURITY DEFINER so RLS policies can consult profiles /
-- ownership tables without recursing into their own policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who am I?
-- ---------------------------------------------------------------------------
create or replace function pms.my_role()
returns app_role
language sql
stable
security definer
set search_path = public, pms
as $$
  select role from profiles where id = auth.uid() and is_active;
$$;

create or replace function pms.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce(pms.my_role() = 'super_admin', false);
$$;

-- Roles that work inside the back office (as opposed to portal users).
create or replace function pms.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce(
    pms.my_role() in ('super_admin','property_manager','agent','finance','marketing','maintenance'),
    false
  );
$$;

-- Roles allowed to see money in full.
create or replace function pms.is_finance()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce(pms.my_role() in ('super_admin','finance'), false);
$$;

-- Roles that may create/modify property, lease and booking records.
create or replace function pms.is_manager()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce(pms.my_role() in ('super_admin','property_manager'), false);
$$;

-- ---------------------------------------------------------------------------
-- Unit scoping. One function, used by nearly every policy.
-- ---------------------------------------------------------------------------
create or replace function pms.owns_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1
    from unit_ownerships uo
    join owner_users ou on ou.owner_id = uo.owner_id
    where uo.unit_id = p_unit_id
      and uo.end_date is null
      and ou.profile_id = auth.uid()
  );
$$;

create or replace function pms.my_owner_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pms
as $$
  select owner_id from owner_users where profile_id = auth.uid();
$$;

create or replace function pms.tenants_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1
    from leases l
    join tenants t on t.id = l.tenant_id
    where l.unit_id = p_unit_id
      and t.profile_id = auth.uid()
      and l.status in ('pending_signature','active','expiring','renewed')
  );
$$;

create or replace function pms.stays_in_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1
    from bookings b
    join guests g on g.id = b.guest_id
    where b.unit_id = p_unit_id
      and g.profile_id = auth.uid()
      and b.status in ('confirmed','checked_in')
      and b.check_out >= current_date - 7
  );
$$;

-- Staff assignment: super admin, finance and marketing see everything;
-- property managers, agents and maintenance staff see only what they are
-- assigned to (directly on the unit, or via the whole property).
create or replace function pms.staff_scoped_to_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select case
    when pms.my_role() in ('super_admin','finance','marketing') then true
    when pms.my_role() in ('property_manager','agent','maintenance') then exists (
      select 1 from staff_unit_assignments sua
      where sua.unit_id = p_unit_id and sua.profile_id = auth.uid()
      union all
      select 1 from staff_property_assignments spa
      join units u on u.property_id = spa.property_id
      where u.id = p_unit_id and spa.profile_id = auth.uid()
    )
    else false
  end;
$$;

-- The master gate used by unit-scoped policies.
create or replace function pms.can_read_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.staff_scoped_to_unit(p_unit_id)
      or pms.owns_unit(p_unit_id)
      or pms.tenants_unit(p_unit_id)
      or pms.stays_in_unit(p_unit_id);
$$;

create or replace function pms.can_write_unit(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.my_role() in ('super_admin','property_manager','agent')
     and pms.staff_scoped_to_unit(p_unit_id);
$$;

-- ---------------------------------------------------------------------------
-- Cross-table access helpers.
--
-- These exist because RLS policies must never query a table whose own policy
-- queries back: `leases` <-> `tenants` and `bookings` <-> `guests` would
-- recurse forever. Wrapping each lookup in a SECURITY DEFINER function breaks
-- the cycle, because the body runs with RLS bypassed.
-- ---------------------------------------------------------------------------
create or replace function pms.is_my_tenant_record(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from tenants where id = p_tenant_id and profile_id = auth.uid()
  );
$$;

create or replace function pms.is_my_guest_record(p_guest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from guests where id = p_guest_id and profile_id = auth.uid()
  );
$$;

create or replace function pms.can_read_tenant(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.is_my_tenant_record(p_tenant_id)
      or pms.my_role() in ('super_admin','finance')
      or exists (
           select 1 from leases l
           where l.tenant_id = p_tenant_id
             and pms.staff_scoped_to_unit(l.unit_id)
         );
$$;

create or replace function pms.can_read_guest(p_guest_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.is_my_guest_record(p_guest_id)
      or pms.my_role() in ('super_admin','finance')
      or exists (
           select 1 from bookings b
           where b.guest_id = p_guest_id
             and pms.staff_scoped_to_unit(b.unit_id)
         );
$$;

create or replace function pms.can_read_lease(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from leases l
    where l.id = p_lease_id
      and (pms.can_read_unit(l.unit_id) or pms.is_my_tenant_record(l.tenant_id))
  );
$$;

create or replace function pms.can_write_lease(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from leases l
    where l.id = p_lease_id and pms.can_write_unit(l.unit_id)
  );
$$;

-- Tenants may maintain their own declared-occupant list: that is what keeps
-- the Ejari record current within the 30-day window.
create or replace function pms.can_declare_occupants(p_lease_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from leases l
    where l.id = p_lease_id
      and (pms.can_write_unit(l.unit_id) or pms.is_my_tenant_record(l.tenant_id))
  );
$$;

create or replace function pms.can_read_booking(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking_id
      and (pms.can_read_unit(b.unit_id) or pms.is_my_guest_record(b.guest_id))
  );
$$;

create or replace function pms.can_register_booking_guests(p_booking_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking_id
      and (pms.can_write_unit(b.unit_id) or pms.is_my_guest_record(b.guest_id))
  );
$$;

create or replace function pms.can_read_property(p_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.my_role() in ('super_admin','finance','marketing')
      or exists (
           select 1 from units u
           where u.property_id = p_property_id and pms.can_read_unit(u.id)
         );
$$;

grant execute on all functions in schema pms to authenticated;

-- ============================================================================
-- Reporting views
-- ============================================================================

-- ---------------------------------------------------------------------------
-- v_units_overview : the shape the unit list / property card needs, without
-- the client having to run six joins.
-- ---------------------------------------------------------------------------
create or replace view v_units_overview
with (security_invoker = true)
as
select
  u.id,
  u.unit_number,
  u.reference_code,
  u.kind,
  u.bedrooms,
  u.bathrooms,
  u.size_sqft,
  u.furnishing,
  u.operating_mode,
  u.status,
  u.target_annual_rent_aed,
  u.base_nightly_rate_aed,
  u.is_active,
  p.id   as property_id,
  p.name as property_name,
  p.kind as property_kind,
  c.id   as community_id,
  c.name as community_name,
  c.emirate,
  -- Primary owner
  o.id   as owner_id,
  o.full_name as owner_name,
  -- Current long-term lease
  l.id   as current_lease_id,
  l.lease_number,
  l.end_date as lease_end_date,
  l.annual_rent_aed,
  l.ejari_status,
  l.ejari_expiry,
  -- Live DET permit
  hp.permit_number as det_permit_number,
  hp.expires_on    as det_permit_expiry,
  pms.unit_has_valid_permit(u.id) as has_valid_permit,
  -- Cover image
  (select um.storage_path from unit_media um
    where um.unit_id = u.id order by um.is_cover desc, um.sort_order limit 1) as cover_path,
  (select count(*) from maintenance_requests mr
    where mr.unit_id = u.id
      and mr.status not in ('closed','cancelled','rejected')) as open_tickets
from units u
join properties p on p.id = u.property_id
left join communities c on c.id = p.community_id
left join lateral (
  select uo.owner_id from unit_ownerships uo
  where uo.unit_id = u.id and uo.end_date is null
  order by uo.is_primary_contact desc, uo.ownership_pct desc limit 1
) po on true
left join owners o on o.id = po.owner_id
left join lateral (
  select * from leases lx
  where lx.unit_id = u.id and lx.status in ('active','expiring')
  order by lx.start_date desc limit 1
) l on true
left join lateral (
  select * from holiday_home_permits hx
  where hx.unit_id = u.id and hx.status = 'active'
  order by hx.expires_on desc limit 1
) hp on true;

-- ---------------------------------------------------------------------------
-- v_compliance_calendar : one unified feed of everything that expires.
-- This is the single source for the compliance dashboard and the alert job.
-- ---------------------------------------------------------------------------
create or replace view v_compliance_calendar
with (security_invoker = true)
as
with settings as (select * from company_settings where id)
-- Ejari registration expiry
select
  'ejari_expiry'::compliance_kind as kind,
  'lease'::document_entity        as entity_kind,
  l.id                            as entity_id,
  l.unit_id,
  null::uuid                      as owner_id,
  'Ejari ' || coalesce(l.ejari_contract_number, l.lease_number) as label,
  l.ejari_expiry                  as due_date,
  (l.ejari_expiry - current_date) as days_remaining
from leases l
where l.ejari_status = 'registered'
  and l.ejari_expiry is not null
  and l.status in ('active','expiring')

union all
-- Ejari occupant declaration staleness (2026 30-day data-currency rule).
-- Due date = the deadline by which Ejari must be updated.
select
  'ejari_occupant_declaration'::compliance_kind,
  'lease'::document_entity,
  l.id,
  l.unit_id,
  null::uuid,
  'Ejari occupant details - ' || l.lease_number,
  (oc.last_change::date + (select ejari_occupant_update_days from settings)),
  (oc.last_change::date + (select ejari_occupant_update_days from settings)) - current_date
from leases l
join lateral (
  select max(greatest(o.updated_at, o.created_at)) as last_change
  from lease_occupants o
  where o.lease_id = l.id and o.removed_on is null
) oc on true
where l.status in ('active','expiring')
  and oc.last_change is not null
  -- Stale = occupants changed since the last push to Ejari (or never pushed).
  and (l.ejari_occupants_synced_at is null
       or l.ejari_occupants_synced_at < oc.last_change)

union all
-- Lease expiry itself
select
  'lease_expiry'::compliance_kind,
  'lease'::document_entity,
  l.id,
  l.unit_id,
  null::uuid,
  'Tenancy ' || l.lease_number,
  l.end_date,
  l.end_date - current_date
from leases l
where l.status in ('active','expiring')

union all
-- DET holiday home permit
select
  'det_permit_expiry'::compliance_kind,
  'permit'::document_entity,
  hp.id,
  hp.unit_id,
  null::uuid,
  'DET permit ' || hp.permit_number,
  hp.expires_on,
  hp.expires_on - current_date
from holiday_home_permits hp
where hp.status = 'active'

union all
-- Building NOC backing the permit
select
  'building_noc_expiry'::compliance_kind,
  'permit'::document_entity,
  hp.id,
  hp.unit_id,
  null::uuid,
  'Building NOC ' || coalesce(hp.noc_reference, ''),
  hp.noc_expires_on,
  hp.noc_expires_on - current_date
from holiday_home_permits hp
where hp.status = 'active' and hp.noc_expires_on is not null

union all
-- Management agreement
select
  'management_agreement_expiry'::compliance_kind,
  'management_agreement'::document_entity,
  ma.id,
  ma.unit_id,
  ma.owner_id,
  'Management agreement ' || coalesce(ma.agreement_number, ''),
  ma.end_date,
  ma.end_date - current_date
from management_agreements ma
where ma.is_active

union all
-- Any document in the vault carrying an expiry date
select
  case d.kind
    when 'insurance_policy' then 'insurance_expiry'
    when 'emirates_id'      then 'emirates_id_expiry'
    when 'passport'         then 'passport_expiry'
    when 'trade_licence'    then 'trade_licence_expiry'
    else 'document_expiry'
  end::compliance_kind,
  d.entity_kind,
  d.id,
  d.unit_id,
  d.owner_id,
  d.title,
  d.expires_on,
  d.expires_on - current_date
from documents d
where d.expires_on is not null

union all
-- Preventive maintenance
select
  'preventive_maintenance'::compliance_kind,
  'unit'::document_entity,
  pm.id,
  pm.unit_id,
  null::uuid,
  pm.title,
  pm.next_due_on,
  pm.next_due_on - current_date
from preventive_maintenance_plans pm
where pm.is_active

union all
-- Fleet
select
  'vehicle_registration'::compliance_kind,
  'vehicle'::document_entity,
  v.id, null::uuid, null::uuid,
  'Mulkiya ' || v.plate_number,
  v.registration_expiry,
  v.registration_expiry - current_date
from vehicles v
where v.is_active and v.registration_expiry is not null

union all
select
  'vehicle_insurance'::compliance_kind,
  'vehicle'::document_entity,
  v.id, null::uuid, null::uuid,
  'Vehicle insurance ' || v.plate_number,
  v.insurance_expiry,
  v.insurance_expiry - current_date
from vehicles v
where v.is_active and v.insurance_expiry is not null;

-- Severity banding applied on top, so the thresholds live in one place.
create or replace view v_compliance_status
with (security_invoker = true)
as
select
  cc.*,
  case
    when cc.days_remaining < 0   then 'overdue'
    when cc.days_remaining <= 7  then 'urgent'
    when cc.days_remaining <= 60 then 'due_soon'
    else 'ok'
  end::compliance_severity as severity
from v_compliance_calendar cc
where cc.due_date is not null;

-- ---------------------------------------------------------------------------
-- v_unit_financials : per-unit income/expense rollup driving the P&L views
-- ---------------------------------------------------------------------------
create or replace view v_unit_financials
with (security_invoker = true)
as
select
  le.unit_id,
  date_trunc('month', le.entry_date)::date as period_month,
  sum(le.amount_aed) filter (where le.direction = 'income')  as income_aed,
  sum(le.amount_aed) filter (where le.direction = 'expense') as expense_aed,
  sum(le.vat_amount_aed)                                     as vat_aed,
  sum(case when le.direction = 'income' then le.amount_aed else -le.amount_aed end) as net_aed,
  count(*) as entry_count
from ledger_entries le
where le.unit_id is not null
group by le.unit_id, date_trunc('month', le.entry_date);

-- ---------------------------------------------------------------------------
-- v_occupancy_daily : long-term vs short-term occupancy, for the dashboard
-- ---------------------------------------------------------------------------
create or replace view v_occupancy_daily
with (security_invoker = true)
as
select
  d.day::date as day,
  u.id as unit_id,
  u.operating_mode,
  exists (
    select 1 from leases l
    where l.unit_id = u.id and l.status in ('active','expiring')
      and d.day between l.start_date and l.end_date
  ) as long_term_occupied,
  exists (
    select 1 from bookings b
    where b.unit_id = u.id and b.status in ('confirmed','checked_in','checked_out')
      and d.day >= b.check_in and d.day < b.check_out
  ) as short_term_occupied
from units u
cross join lateral generate_series(
  date_trunc('month', current_date - interval '11 months'),
  date_trunc('month', current_date) + interval '1 month' - interval '1 day',
  interval '1 day'
) d(day)
where u.is_active;
