-- ============================================================================
-- D|R|P PMS - 0014 Owner financial isolation
--
-- Rule: an owner never sees income, payouts, nightly rates, commissions or
-- revenue - not in the UI, not through the API, not by querying Supabase
-- directly with their own session.
--
-- Owners and staff share one Postgres role (`authenticated`), so hiding
-- columns with GRANTs is not possible: anything granted to an owner is granted
-- to every admin too. Instead:
--
--   1. Owners are removed from every RLS policy on a table that carries income
--      or rate data. For those tables an owner's row set is now empty.
--   2. Owners read what they need through three views that contain no money
--      columns at all: owner_units_view, owner_bookings_view and
--      owner_calendar_blocks_view. They run as their owner (which bypasses RLS)
--      and filter to the caller's units with pms.owns_unit(), under
--      security_barrier so a caller-supplied function cannot observe rows
--      before that filter runs. They are SELECT-only.
--
-- Costs the owner pays are not income and stay visible: maintenance quotes
-- (owners approve them), service charges, service orders.
--
-- Also fixes a privilege escalation: new accounts took their role from
-- raw_user_meta_data, which the signing-up client controls.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. New accounts get their role from server-controlled metadata only.
--
-- `raw_user_meta_data` is written by whoever calls auth.signUp(), i.e. anyone
-- holding the public key. Taking the role from it let a stranger create a
-- super_admin. `raw_app_meta_data` can only be set with the service key.
-- Everyone else starts as `guest`, which has no portal and no data.
-- ---------------------------------------------------------------------------
create or replace function pms.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_role app_role := 'guest';
begin
  begin
    v_role := coalesce((new.raw_app_meta_data->>'role')::app_role, 'guest');
  exception when invalid_text_representation then
    v_role := 'guest';
  end;

  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

alter table profiles alter column role set default 'guest';

-- ---------------------------------------------------------------------------
-- 2. Owner-facing setting: may owners see the guest's first name?
-- ---------------------------------------------------------------------------
alter table company_settings
  add column if not exists show_guest_first_name_to_owners boolean not null default false;

comment on column company_settings.show_guest_first_name_to_owners is
  'When true, owner_bookings_view exposes the lead guest''s first name. Off by default.';

-- Imported bookings (Airbnb iCal) carry no guest count. The table requires at
-- least one adult, so imports record 1 and set this false; owners are then
-- shown "not provided" rather than a made-up number.
alter table bookings
  add column if not exists guest_count_known boolean not null default true;

-- ---------------------------------------------------------------------------
-- 3. The unit gate without the owner branch.
--
-- pms.can_read_unit() lets owners through, which is right for permits,
-- photos, maintenance and documents but wrong for anything carrying money.
-- ---------------------------------------------------------------------------
create or replace function pms.can_read_unit_financials(p_unit_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select pms.staff_scoped_to_unit(p_unit_id)
      or pms.tenants_unit(p_unit_id)
      or pms.stays_in_unit(p_unit_id);
$$;

comment on function pms.can_read_unit_financials(uuid) is
  'pms.can_read_unit() minus owners. Gate for every table carrying rates, rent, '
  'booking money or other income - owners reach those units through the '
  'owner_*_view views instead.';

-- Lease and booking children resolve through these, so switching them cuts
-- owners off from installments, deposits, notices, occupants and booking
-- guests in one place.
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
      and (pms.can_read_unit_financials(l.unit_id) or pms.is_my_tenant_record(l.tenant_id))
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
      and (pms.can_read_unit_financials(b.unit_id) or pms.is_my_guest_record(b.guest_id))
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Policies. Each replaced policy keeps its name; only the owner path goes.
-- ---------------------------------------------------------------------------

-- Units carry target rent and nightly rate.
drop policy units_read on units;
create policy units_read on units
  for select to authenticated using (pms.can_read_unit_financials(id));

-- Leases carry rent, deposits and fees.
drop policy leases_read on leases;
create policy leases_read on leases
  for select to authenticated
  using (pms.can_read_unit_financials(unit_id) or pms.is_my_tenant_record(tenant_id));

-- Short-term commercial data.
drop policy channel_listings_read on channel_listings;
create policy channel_listings_read on channel_listings
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

drop policy pricing_connections_read on pricing_connections;
create policy pricing_connections_read on pricing_connections
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

drop policy nightly_rates_read on nightly_rates;
create policy nightly_rates_read on nightly_rates
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

-- Bookings carry the whole revenue breakdown. Owners use owner_bookings_view.
drop policy bookings_read on bookings;
create policy bookings_read on bookings
  for select to authenticated
  using (pms.can_read_unit_financials(unit_id) or pms.is_my_guest_record(guest_id));

-- Owners see blocks through owner_calendar_blocks_view.
drop policy availability_blocks_read on availability_blocks;
create policy availability_blocks_read on availability_blocks
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

drop policy housekeeping_read on housekeeping_tasks;
create policy housekeeping_read on housekeeping_tasks
  for select to authenticated
  using (assigned_to = auth.uid() or pms.can_read_unit_financials(unit_id));

-- Management agreements are the commission terms.
drop policy mgmt_agreements_read on management_agreements;
create policy mgmt_agreements_read on management_agreements
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

-- Purchase prices; owners have no screen that needs these rows.
drop policy unit_ownerships_read on unit_ownerships;
create policy unit_ownerships_read on unit_ownerships
  for select to authenticated using (pms.can_read_unit_financials(unit_id));

-- The ledger, statements, invoices and payments: income and payouts.
drop policy ledger_read on ledger_entries;
create policy ledger_read on ledger_entries
  for select to authenticated
  using (pms.is_finance() or (unit_id is not null and pms.staff_scoped_to_unit(unit_id)));

drop policy owner_statements_read on owner_statements;
create policy owner_statements_read on owner_statements
  for select to authenticated using (pms.is_finance() or pms.is_manager());

drop policy invoices_read on invoices;
create policy invoices_read on invoices
  for select to authenticated
  using (
    pms.is_finance()
    or (unit_id is not null and pms.staff_scoped_to_unit(unit_id))
    or (party_kind = 'tenant' and pms.is_my_tenant_record(party_id))
    or (party_kind = 'guest'  and pms.is_my_guest_record(party_id))
  );

drop policy payments_read on payments;
create policy payments_read on payments
  for select to authenticated
  using (pms.is_finance() or (unit_id is not null and pms.staff_scoped_to_unit(unit_id)));

-- Outbound messages to owners include statement and payout notifications.
drop policy messages_read on messages;
create policy messages_read on messages
  for select to authenticated
  using (
    pms.is_staff()
    or (party_kind = 'tenant' and pms.is_my_tenant_record(party_id))
    or (party_kind = 'guest'  and pms.is_my_guest_record(party_id))
  );

-- Company settings hold the default commission rates. Staff only; the few
-- values a portal needs come from portal_settings() below.
drop policy company_settings_read on company_settings;
create policy company_settings_read on company_settings
  for select to authenticated using (pms.is_staff());

-- ---------------------------------------------------------------------------
-- 5. Documents: owners keep their documents, minus anything that states
-- income. Tenancy contracts and Ejari certificates state the rent; invoices,
-- receipts and cheque copies are rent collection records.
-- ---------------------------------------------------------------------------
create or replace function pms.is_income_document(p_kind document_kind)
returns boolean
language sql
immutable
as $$
  select p_kind in (
    'owner_statement', 'invoice', 'receipt', 'cheque_copy',
    'tenancy_contract', 'ejari_certificate'
  );
$$;

comment on function pms.is_income_document(document_kind) is
  'Document kinds that state income or rent. Hidden from owners by documents_read.';

drop policy documents_read on documents;
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
    and (pms.my_role() is distinct from 'owner' or not pms.is_income_document(kind))
  );

-- ---------------------------------------------------------------------------
-- 6. The maintenance approval trigger ran as the caller and read the
-- threshold from company_settings, which owners can no longer see. Read it
-- through a definer helper so owner approvals keep working.
-- ---------------------------------------------------------------------------
create or replace function pms.maintenance_threshold()
returns numeric
language sql
stable
security definer
set search_path = public, pms
as $$
  select maintenance_owner_approval_threshold from company_settings where id;
$$;

create or replace function pms.flag_owner_approval()
returns trigger
language plpgsql
as $$
declare
  threshold numeric(12,2) := pms.maintenance_threshold();
begin
  if coalesce(new.quoted_amount_aed, 0) > threshold and new.cost_borne_by = 'owner' then
    new.owner_approval_required := true;
  end if;

  -- Work may not start on an owner-billed job above the threshold until the
  -- owner has actually approved it.
  if new.owner_approval_required
     and new.owner_approved_at is null
     and new.status in ('approved','scheduled','in_progress','completed') then
    raise exception
      'Ticket % requires owner approval before work proceeds (quote AED %, threshold AED %)',
      new.ticket_number, new.quoted_amount_aed, threshold
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. Audit trigger fix. company_settings is keyed by a boolean (`id = true`),
-- and write_audit() cast every row's id to uuid - so saving company settings
-- failed with "invalid input syntax for type uuid". Non-uuid ids are now
-- recorded as a null entity_id; the full row is still in before/after_data.
-- ---------------------------------------------------------------------------
create or replace function pms.write_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_actor  uuid := auth.uid();
  v_role   app_role;
  v_before jsonb;
  v_after  jsonb;
  v_fields text[];
  v_id     text;
begin
  select role into v_role from profiles where id = v_actor;

  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after  := to_jsonb(new);
    select array_agg(key) into v_fields
    from jsonb_each(v_after) a
    where a.value is distinct from v_before -> a.key;

    -- Nothing of substance changed (only updated_at) - skip the noise.
    if v_fields is null or v_fields <@ array['updated_at'] then
      return new;
    end if;
  end if;

  v_id := coalesce(v_after ->> 'id', v_before ->> 'id');

  insert into audit_log (actor_id, actor_role, action, entity_table, entity_id,
                         changed_fields, before_data, after_data)
  values (
    v_actor,
    v_role,
    lower(tg_op)::audit_action,
    tg_table_name,
    case when v_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         then v_id::uuid end,
    v_fields,
    v_before,
    v_after
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Settings a portal user may see. Nothing financial except the
-- maintenance approval threshold, which is a cost the owner signs off.
-- ---------------------------------------------------------------------------
create or replace function portal_settings()
returns table (
  trade_name text,
  phone text,
  email text,
  website text,
  brand_primary_hex text,
  brand_accent_hex text,
  maintenance_owner_approval_threshold numeric,
  show_guest_first_name_to_owners boolean
)
language sql
stable
security definer
set search_path = public, pms
as $$
  select trade_name, phone, email, website, brand_primary_hex, brand_accent_hex,
         maintenance_owner_approval_threshold, show_guest_first_name_to_owners
  from company_settings
  where id and auth.uid() is not null;
$$;

revoke all on function portal_settings() from public, anon;
grant execute on function portal_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Owner-safe views. Every column is listed explicitly: adding a money
-- column to units or bookings later cannot leak through a `select *`.
-- ---------------------------------------------------------------------------
create or replace view owner_units_view
with (security_barrier = true)
as
select
  u.id,
  u.unit_number,
  u.reference_code,
  u.kind,
  u.floor,
  u.bedrooms,
  u.bathrooms,
  u.size_sqft,
  u.furnishing,
  u.operating_mode,
  u.status,
  u.max_guests,
  u.is_active,
  p.id   as property_id,
  p.name as property_name,
  c.name as community_name,
  hp.permit_number as det_permit_number,
  hp.expires_on    as det_permit_expiry,
  (select um.storage_path from unit_media um
    where um.unit_id = u.id order by um.is_cover desc, um.sort_order limit 1) as cover_path
from units u
join properties p on p.id = u.property_id
left join communities c on c.id = p.community_id
left join lateral (
  select hx.permit_number, hx.expires_on
  from holiday_home_permits hx
  where hx.unit_id = u.id and hx.status = 'active'
  order by hx.expires_on desc limit 1
) hp on true
where pms.owns_unit(u.id);

comment on view owner_units_view is
  'The caller''s own units, with no rent, rate or other money columns. Owner portal only.';

create or replace view owner_bookings_view
with (security_barrier = true)
as
select
  b.id,
  b.unit_id,
  u.unit_number,
  p.name as property_name,
  b.booking_number,
  b.check_in,
  b.check_out,
  b.nights,
  case when b.guest_count_known then b.adults + b.children end as guests,
  case when b.guest_count_known then b.adults end   as adults,
  case when b.guest_count_known then b.children end as children,
  case when b.guest_count_known then b.infants end  as infants,
  b.channel as source,
  b.status,
  case
    when s.show_guest_first_name_to_owners
    then nullif(split_part(btrim(g.full_name), ' ', 1), '')
  end as guest_first_name
from bookings b
join units u on u.id = b.unit_id
join properties p on p.id = u.property_id
left join guests g on g.id = b.guest_id
cross join company_settings s
where s.id
  -- Pending requests and cancellations are internal until confirmed.
  and b.status in ('confirmed','checked_in','checked_out')
  and pms.owns_unit(b.unit_id);

comment on view owner_bookings_view is
  'Confirmed stays on the caller''s own units: dates, nights, guest count and '
  'source only. No rates, totals, payouts or commissions. Owner portal only.';

create or replace view owner_calendar_blocks_view
with (security_barrier = true)
as
select
  ab.id,
  ab.unit_id,
  ab.start_date,
  ab.end_date,
  ab.reason
from availability_blocks ab
-- Booking blocks duplicate owner_bookings_view (and would expose tentative
-- stays); everything else - maintenance, owner stays, holds - is shown.
where ab.reason <> 'booking'
  and pms.owns_unit(ab.unit_id);

comment on view owner_calendar_blocks_view is
  'Non-booking calendar blocks on the caller''s own units. Owner portal only.';

-- Read-only. owner_calendar_blocks_view is a single-table view and would
-- otherwise be auto-updatable - running as its owner, past RLS.
revoke all on owner_units_view, owner_bookings_view, owner_calendar_blocks_view
  from public, anon, authenticated;
grant select on owner_units_view, owner_bookings_view, owner_calendar_blocks_view
  to authenticated;
grant select on owner_units_view, owner_bookings_view, owner_calendar_blocks_view
  to service_role;
