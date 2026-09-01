-- ============================================================================
-- D|R|P PMS - 0008 CRM, communications hub, interior design, fleet
-- Phase 3 modules. Tables land now so Phase 1/2 data never needs a breaking
-- migration to accommodate them.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- CRM / leads (deliberately lightweight - the brokerage may keep its own CRM)
-- ---------------------------------------------------------------------------
create table leads (
  id                uuid primary key default gen_random_uuid(),
  reference         text unique,
  source            lead_source not null default 'website',
  intent            lead_intent not null default 'long_term_rent',
  stage             lead_stage not null default 'new',

  full_name         text not null,
  email             text,
  phone             text,
  whatsapp          text,
  nationality       text,
  preferred_locale  text not null default 'en',

  budget_min_aed    numeric(12,2),
  budget_max_aed    numeric(12,2),
  preferred_areas   text[],
  bedrooms_wanted   numeric(3,1),
  move_in_from      date,
  -- Short-stay enquiries carry dates instead of a move-in date
  stay_check_in     date,
  stay_check_out    date,
  party_size        integer,

  unit_id           uuid references units(id) on delete set null,
  assigned_to       uuid references profiles(id) on delete set null,
  next_follow_up_at timestamptz,
  lost_reason       text,

  -- Conversion targets: a won lead becomes a lease or a booking, no re-entry.
  converted_lease_id   uuid references leases(id) on delete set null,
  converted_booking_id uuid references bookings(id) on delete set null,
  converted_tenant_id  uuid references tenants(id) on delete set null,
  converted_guest_id   uuid references guests(id) on delete set null,
  converted_at         timestamptz,

  raw_payload       jsonb,          -- original website/WhatsApp payload
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index leads_stage_idx on leads(stage) where stage not in ('won','lost');
create index leads_assignee_idx on leads(assigned_to);
create index leads_followup_idx on leads(next_follow_up_at) where stage not in ('won','lost');
create trigger leads_touch before update on leads
  for each row execute function pms.touch_updated_at();

create table lead_activities (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references leads(id) on delete cascade,
  author_id   uuid references profiles(id) on delete set null,
  kind        text not null default 'note',      -- note | call | whatsapp | email | viewing
  body        text,
  stage_from  lead_stage,
  stage_to    lead_stage,
  occurred_at timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index lead_activities_lead_idx on lead_activities(lead_id, occurred_at desc);

create table viewings (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references leads(id) on delete cascade,
  unit_id       uuid not null references units(id) on delete cascade,
  agent_id      uuid references profiles(id) on delete set null,
  scheduled_at  timestamptz not null,
  duration_minutes integer not null default 30,
  status        task_status not null default 'pending',
  feedback      text,
  interest_level integer check (interest_level is null or interest_level between 1 and 5),
  vehicle_booking_id uuid,                    -- FK added after vehicle_bookings
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index viewings_unit_idx on viewings(unit_id, scheduled_at);
create index viewings_agent_idx on viewings(agent_id, scheduled_at);
create trigger viewings_touch before update on viewings
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Communications hub. WhatsApp-first, email fallback.
-- Provider is abstracted - business logic must never branch on it.
-- ---------------------------------------------------------------------------
create table message_templates (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  channel      message_channel not null default 'whatsapp',
  locale       text not null default 'en',
  name         text not null,
  category     text not null default 'general',
  subject      text,
  body         text not null,
  -- Variables the renderer will substitute, e.g. {tenant_name}, {due_date}
  variables    text[] not null default '{}',
  -- WhatsApp Business API approved template name, when applicable
  provider_template_name text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (code, channel, locale)
);
create trigger message_templates_touch before update on message_templates
  for each row execute function pms.touch_updated_at();

create table messages (
  id            uuid primary key default gen_random_uuid(),
  channel       message_channel not null,
  direction     message_direction not null default 'outbound',
  status        message_status not null default 'queued',
  template_id   uuid references message_templates(id) on delete set null,

  party_kind    party_kind not null,
  party_id      uuid,
  to_address    text not null,               -- phone (E.164) or email
  from_address  text,

  unit_id       uuid references units(id) on delete set null,
  lease_id      uuid references leases(id) on delete set null,
  booking_id    uuid references bookings(id) on delete set null,
  maintenance_request_id uuid references maintenance_requests(id) on delete set null,

  subject       text,
  body          text not null,
  variables     jsonb,
  provider      text,
  provider_message_id text,
  error_message text,
  queued_at     timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz,
  read_at       timestamptz,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index messages_party_idx on messages(party_kind, party_id, created_at desc);
create index messages_unit_idx on messages(unit_id, created_at desc);
create index messages_pending_idx on messages(queued_at) where status = 'queued';

-- ---------------------------------------------------------------------------
-- Module L: interior design / furnishing service orders
-- ---------------------------------------------------------------------------
create table service_orders (
  id                uuid primary key default gen_random_uuid(),
  order_number      text unique not null,
  kind              service_order_kind not null default 'furnishing',
  status            service_order_status not null default 'requested',
  unit_id           uuid not null references units(id) on delete cascade,
  owner_id          uuid references owners(id) on delete set null,
  tenant_id         uuid references tenants(id) on delete set null,
  requested_by      uuid references profiles(id) on delete set null,

  title             text not null,
  brief             text,
  quoted_amount_aed numeric(12,2),
  approved_amount_aed numeric(12,2),
  final_amount_aed  numeric(12,2),
  vat_applicable    boolean not null default true,   -- furnishing is a taxable supply

  quoted_at         timestamptz,
  approved_by       uuid references profiles(id) on delete set null,
  approved_at       timestamptz,
  started_at        timestamptz,
  delivered_at      timestamptz,
  invoice_id        uuid references invoices(id) on delete set null,
  ledger_entry_id   uuid references ledger_entries(id) on delete set null,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index service_orders_unit_idx on service_orders(unit_id);
create index service_orders_status_idx on service_orders(status)
  where status not in ('delivered','cancelled','invoiced');
create trigger service_orders_touch before update on service_orders
  for each row execute function pms.touch_updated_at();

create table service_order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references service_orders(id) on delete cascade,
  description    text not null,
  room           text,
  quantity       numeric(10,2) not null default 1,
  unit_cost_aed  numeric(12,2) not null default 0,
  line_total_aed numeric(12,2) generated always as (round(quantity * unit_cost_aed, 2)) stored,
  supplier       text,
  lead_time_days integer,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now()
);
create index service_order_items_order_idx on service_order_items(order_id, sort_order);

-- ---------------------------------------------------------------------------
-- Module M: fleet register (simple internal scheduling tool)
-- ---------------------------------------------------------------------------
create table vehicles (
  id                uuid primary key default gen_random_uuid(),
  make              text not null,
  model             text not null,
  model_year        integer,
  colour            text,
  plate_number      text not null,
  plate_emirate     emirate not null default 'dubai',
  plate_code        text,
  vin               text,
  category          vehicle_category not null default 'staff',
  seats             integer not null default 5,
  registration_expiry date,                 -- Mulkiya
  insurance_expiry  date,
  insurance_policy_number text,
  odometer_km       integer,
  default_driver_id uuid references profiles(id) on delete set null,
  is_active         boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (plate_emirate, plate_code, plate_number)
);
create index vehicles_expiry_idx on vehicles(registration_expiry, insurance_expiry) where is_active;
create trigger vehicles_touch before update on vehicles
  for each row execute function pms.touch_updated_at();

create table vehicle_bookings (
  id            uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references vehicles(id) on delete cascade,
  driver_id     uuid references profiles(id) on delete set null,
  purpose       vehicle_booking_purpose not null default 'viewing',
  status        task_status not null default 'pending',
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  pickup        text,
  destination   text,
  passenger_name text,
  lead_id       uuid references leads(id) on delete set null,
  viewing_id    uuid references viewings(id) on delete set null,
  booking_id    uuid references bookings(id) on delete set null,   -- guest transfer
  odometer_start integer,
  odometer_end  integer,
  notes         text,
  created_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_at > start_at)
);
create index vehicle_bookings_vehicle_idx on vehicle_bookings(vehicle_id, start_at);
create trigger vehicle_bookings_touch before update on vehicle_bookings
  for each row execute function pms.touch_updated_at();

-- One vehicle, one trip at a time.
alter table vehicle_bookings add constraint vehicle_bookings_no_overlap
  exclude using gist (
    vehicle_id with =,
    tstzrange(start_at, end_at) with &&
  ) where (status in ('pending','assigned','in_progress'));

alter table viewings
  add constraint viewings_vehicle_booking_fk
  foreign key (vehicle_booking_id) references vehicle_bookings(id) on delete set null;
