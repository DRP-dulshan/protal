-- ============================================================================
-- D|R|P PMS - 0007 Maintenance, vendors, documents, compliance, audit trail
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vendors / contractors
-- ---------------------------------------------------------------------------
create table vendors (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  categories        maintenance_category[] not null default '{}',
  contact_name      text,
  phone             text,
  whatsapp          text,
  email             text,
  trade_licence_number text,
  trade_licence_expiry date,
  trn               text,
  address_line      text,
  hourly_rate_aed   numeric(10,2),
  callout_fee_aed   numeric(10,2),
  payment_terms_days integer not null default 30,
  rating            numeric(2,1) check (rating is null or (rating >= 0 and rating <= 5)),
  is_approved       boolean not null default false,
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger vendors_touch before update on vendors
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Maintenance requests
-- Owner approval is required once the quote exceeds the configured threshold.
-- ---------------------------------------------------------------------------
create table maintenance_requests (
  id                uuid primary key default gen_random_uuid(),
  ticket_number     text unique not null,
  unit_id           uuid not null references units(id) on delete cascade,
  lease_id          uuid references leases(id) on delete set null,
  booking_id        uuid references bookings(id) on delete set null,

  category          maintenance_category not null default 'other',
  priority          maintenance_priority not null default 'medium',
  status            maintenance_status not null default 'submitted',
  title             text not null,
  description       text,
  access_notes      text,               -- keys, guest in residence, pets etc.

  raised_by         uuid references profiles(id) on delete set null,
  raised_by_kind    party_kind not null default 'staff',
  reported_at       timestamptz not null default now(),
  acknowledged_at   timestamptz,

  assigned_to       uuid references profiles(id) on delete set null,
  vendor_id         uuid references vendors(id) on delete set null,
  scheduled_for     timestamptz,

  quoted_amount_aed   numeric(12,2),
  approved_amount_aed numeric(12,2),
  final_amount_aed    numeric(12,2),
  cost_borne_by       cost_bearer not null default 'owner',

  owner_approval_required boolean not null default false,
  owner_approved_by   uuid references profiles(id) on delete set null,
  owner_approved_at   timestamptz,
  owner_rejected_at   timestamptz,
  owner_rejection_reason text,

  started_at        timestamptz,
  completed_at      timestamptz,
  closed_at         timestamptz,
  resolution_notes  text,
  tenant_rating     integer check (tenant_rating is null or tenant_rating between 1 and 5),
  ledger_entry_id   uuid references ledger_entries(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index maintenance_unit_idx on maintenance_requests(unit_id);
create index maintenance_status_idx on maintenance_requests(status)
  where status not in ('closed','cancelled','rejected');
create index maintenance_assignee_idx on maintenance_requests(assigned_to)
  where status not in ('closed','cancelled','rejected');
create index maintenance_vendor_idx on maintenance_requests(vendor_id);
create trigger maintenance_touch before update on maintenance_requests
  for each row execute function pms.touch_updated_at();

-- Flip the owner-approval flag as soon as a quote crosses the threshold.
create or replace function pms.flag_owner_approval()
returns trigger
language plpgsql
as $$
declare
  threshold numeric(12,2);
begin
  select maintenance_owner_approval_threshold into threshold from company_settings where id;

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

create trigger maintenance_owner_approval_gate
  before insert or update on maintenance_requests
  for each row execute function pms.flag_owner_approval();

create table maintenance_updates (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references maintenance_requests(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  note        text,
  status_from maintenance_status,
  status_to   maintenance_status,
  is_internal boolean not null default false,   -- hidden from tenant/owner portals
  created_at  timestamptz not null default now()
);
create index maintenance_updates_request_idx on maintenance_updates(request_id, created_at);

-- ---------------------------------------------------------------------------
-- Preventive maintenance (AC servicing, pest control, fire safety, pool)
-- ---------------------------------------------------------------------------
create table preventive_maintenance_plans (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid references units(id) on delete cascade,
  property_id       uuid references properties(id) on delete cascade,
  category          maintenance_category not null,
  title             text not null,
  frequency_months  integer not null default 6 check (frequency_months > 0),
  vendor_id         uuid references vendors(id) on delete set null,
  estimated_cost_aed numeric(12,2),
  last_completed_on date,
  next_due_on       date not null,
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (unit_id is not null or property_id is not null)
);
create index pm_plans_due_idx on preventive_maintenance_plans(next_due_on) where is_active;
create trigger pm_plans_touch before update on preventive_maintenance_plans
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Document vault
-- Polymorphic by (entity_kind, entity_id). Sensitive documents (ID copies,
-- bank letters) carry is_sensitive so RLS can restrict them further.
-- ---------------------------------------------------------------------------
create table documents (
  id              uuid primary key default gen_random_uuid(),
  kind            document_kind not null default 'other',
  entity_kind     document_entity not null,
  entity_id       uuid,
  -- Denormalised unit link so unit-scoped RLS and the unit vault stay simple
  -- even for documents attached to a lease or booking.
  unit_id         uuid references units(id) on delete cascade,
  owner_id        uuid references owners(id) on delete cascade,

  title           text not null,
  bucket          text not null default 'documents',
  storage_path    text not null,
  file_name       text not null,
  mime_type       text,
  size_bytes      bigint,
  checksum        text,

  reference_number text,                 -- Ejari no, permit no, policy no...
  issued_on       date,
  expires_on      date,
  issuing_authority text,

  is_sensitive    boolean not null default false,
  is_owner_visible boolean not null default true,
  is_tenant_visible boolean not null default false,

  version         integer not null default 1,
  replaces_id     uuid references documents(id) on delete set null,
  uploaded_by     uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index documents_entity_idx on documents(entity_kind, entity_id);
create index documents_unit_idx on documents(unit_id);
create index documents_owner_idx on documents(owner_id);
create index documents_expiry_idx on documents(expires_on) where expires_on is not null;
create index documents_kind_idx on documents(kind);
create trigger documents_touch before update on documents
  for each row execute function pms.touch_updated_at();

alter table booking_guests
  add constraint booking_guests_id_document_fk
  foreign key (id_document_id) references documents(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Compliance alerts: one row per (item, threshold) actually dispatched, so a
-- reminder is never sent twice for the same window.
-- ---------------------------------------------------------------------------
create table compliance_alerts (
  id            uuid primary key default gen_random_uuid(),
  kind          compliance_kind not null,
  entity_kind   document_entity not null,
  entity_id     uuid not null,
  unit_id       uuid references units(id) on delete cascade,
  owner_id      uuid references owners(id) on delete cascade,
  label         text not null,
  due_date      date not null,
  threshold_days integer not null,
  severity      compliance_severity not null default 'due_soon',
  channel       message_channel,
  sent_at       timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  unique (kind, entity_id, due_date, threshold_days)
);
create index compliance_alerts_due_idx on compliance_alerts(due_date) where resolved_at is null;

-- ---------------------------------------------------------------------------
-- Audit trail. Written by triggers on financial and compliance tables so it
-- cannot be bypassed by application code.
-- ---------------------------------------------------------------------------
create table audit_log (
  id          bigserial primary key,
  actor_id    uuid references profiles(id) on delete set null,
  actor_role  app_role,
  action      audit_action not null,
  entity_table text not null,
  entity_id   uuid,
  changed_fields text[],
  before_data jsonb,
  after_data  jsonb,
  note        text,
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index audit_entity_idx on audit_log(entity_table, entity_id, created_at desc);
create index audit_actor_idx on audit_log(actor_id, created_at desc);

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

  insert into audit_log (actor_id, actor_role, action, entity_table, entity_id,
                         changed_fields, before_data, after_data)
  values (
    v_actor,
    v_role,
    lower(tg_op)::audit_action,
    tg_table_name,
    coalesce((v_after ->> 'id')::uuid, (v_before ->> 'id')::uuid),
    v_fields,
    v_before,
    v_after
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Audit the records regulators and owners will ask about.
do $$
declare
  t text;
begin
  foreach t in array array[
    'leases','lease_installments','lease_occupants','rent_increase_notices','lease_notices',
    'holiday_home_permits','bookings','management_agreements','unit_ownerships',
    'ledger_entries','invoices','payments','owner_statements','service_charge_invoices',
    'documents','maintenance_requests','owner_bank_accounts','company_settings','profiles'
  ]
  loop
    execute format(
      'create trigger %I after insert or update or delete on %I
         for each row execute function pms.write_audit()',
      t || '_audit', t
    );
  end loop;
end;
$$;
