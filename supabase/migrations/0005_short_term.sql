-- ============================================================================
-- D|R|P PMS - 0005 Holiday Homes / short-term rental (DET-ready)
--
-- Dubai specifics:
--   * DET (formerly DTCM) holiday home permit per unit, with building NOC
--   * A unit cannot go live on any channel without a valid, unexpired permit
--   * Permit number must appear on every OTA listing (DET requirement)
--   * Guest registration records retained per booking
--   * Tourism Dirham fee tracked per booking
-- ============================================================================

create table holiday_home_permits (
  id                 uuid primary key default gen_random_uuid(),
  unit_id            uuid not null references units(id) on delete cascade,
  permit_number      text not null,
  operator_name      text,                       -- licensed operator on the permit
  operator_licence_number text,
  det_classification text,                       -- e.g. 'Deluxe' / 'Standard'
  issued_on          date not null,
  expires_on         date not null,
  status             permit_status not null default 'active',
  -- Building/developer NOC permitting short-term use
  noc_reference      text,
  noc_expires_on     date,
  renewal_reminder_days integer not null default 60,
  renewal_submitted_on  date,
  notes              text,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (expires_on > issued_on)
);
create unique index hh_permits_number_idx on holiday_home_permits(permit_number)
  where status in ('active','pending');
create index hh_permits_unit_idx on holiday_home_permits(unit_id);
create index hh_permits_expiry_idx on holiday_home_permits(expires_on) where status = 'active';
create trigger hh_permits_touch before update on holiday_home_permits
  for each row execute function pms.touch_updated_at();

-- Does this unit currently hold a valid DET permit?
create or replace function pms.unit_has_valid_permit(p_unit_id uuid, p_on date default current_date)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from holiday_home_permits
    where unit_id = p_unit_id
      and status = 'active'
      and issued_on <= p_on
      and expires_on >= p_on
  );
$$;

-- The permit number to print on OTA listings (DET requires it on every listing).
create or replace function pms.unit_permit_number(p_unit_id uuid)
returns text
language sql
stable
as $$
  select permit_number
  from holiday_home_permits
  where unit_id = p_unit_id and status = 'active' and expires_on >= current_date
  order by expires_on desc
  limit 1;
$$;

-- ---------------------------------------------------------------------------
-- Channel listings. Provider-agnostic: the sync fields exist now, the actual
-- OTA API calls land in Phase 3 behind lib/channels/*.
-- ---------------------------------------------------------------------------
create table channel_listings (
  id                  uuid primary key default gen_random_uuid(),
  unit_id             uuid not null references units(id) on delete cascade,
  channel             sales_channel not null,
  external_listing_id text,
  listing_url         text,
  is_active           boolean not null default false,
  headline            text,
  description         text,
  -- Denormalised so listing content can be generated/validated without a join.
  displayed_permit_number text,
  base_rate_aed       numeric(10,2),
  min_nights          integer not null default 1,
  cleaning_fee_aed    numeric(10,2),
  channel_commission_pct numeric(5,2),
  last_synced_at      timestamptz,
  sync_status         text,
  sync_error          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (unit_id, channel)
);
create index channel_listings_unit_idx on channel_listings(unit_id);
create trigger channel_listings_touch before update on channel_listings
  for each row execute function pms.touch_updated_at();

-- Hard gate: no unit goes live on a channel without a valid DET permit, and
-- the permit number is stamped onto the listing automatically.
create or replace function pms.enforce_permit_before_listing()
returns trigger
language plpgsql
as $$
begin
  if new.is_active then
    if not pms.unit_has_valid_permit(new.unit_id) then
      raise exception
        'Unit % cannot be listed for short-term rental: no valid DET holiday home permit on file',
        new.unit_id
        using errcode = 'check_violation';
    end if;
    new.displayed_permit_number := pms.unit_permit_number(new.unit_id);
  end if;
  return new;
end;
$$;

create trigger channel_listings_permit_gate
  before insert or update of is_active, unit_id on channel_listings
  for each row execute function pms.enforce_permit_before_listing();

-- Dynamic pricing integration point (PriceLabs-style). We store the connection
-- and the guard rails; the pricing engine itself is external.
create table pricing_connections (
  id              uuid primary key default gen_random_uuid(),
  unit_id         uuid not null references units(id) on delete cascade,
  provider        text not null,               -- 'pricelabs' | 'wheelhouse' | 'manual'
  external_ref    text,
  is_active       boolean not null default false,
  min_rate_aed    numeric(10,2),
  max_rate_aed    numeric(10,2),
  base_rate_aed   numeric(10,2),
  last_pulled_at  timestamptz,
  last_pushed_at  timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (unit_id, provider)
);
create trigger pricing_connections_touch before update on pricing_connections
  for each row execute function pms.touch_updated_at();

-- Nightly rate overrides (manual or pushed from the pricing provider).
create table nightly_rates (
  unit_id     uuid not null references units(id) on delete cascade,
  stay_date   date not null,
  rate_aed    numeric(10,2) not null,
  min_nights  integer,
  is_available boolean not null default true,
  source      text not null default 'manual',
  updated_at  timestamptz not null default now(),
  primary key (unit_id, stay_date)
);

-- ---------------------------------------------------------------------------
-- Guests
-- ---------------------------------------------------------------------------
create table guests (
  id               uuid primary key default gen_random_uuid(),
  full_name        text not null,
  email            text,
  phone            text,
  whatsapp         text,
  nationality      text,
  date_of_birth    date,
  passport_number  text,
  passport_expiry  date,
  emirates_id      text,
  address_line     text,
  preferred_locale text not null default 'en',
  profile_id       uuid references profiles(id) on delete set null,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index guests_profile_idx on guests(profile_id);
create trigger guests_touch before update on guests
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Bookings
-- Internal accounting is always AED. quoted_currency / fx_rate only record
-- what the guest was shown.
-- ---------------------------------------------------------------------------
create table bookings (
  id                    uuid primary key default gen_random_uuid(),
  booking_number        text unique not null,
  unit_id               uuid not null references units(id) on delete restrict,
  guest_id              uuid references guests(id) on delete set null,
  channel               sales_channel not null default 'direct',
  external_booking_id   text,
  status                booking_status not null default 'inquiry',

  check_in              date not null,
  check_out             date not null,
  nights                integer generated always as (check_out - check_in) stored,
  check_in_time         time,
  check_out_time        time,
  adults                integer not null default 1,
  children              integer not null default 0,
  infants               integer not null default 0,

  -- Money (AED base)
  nightly_rate_aed      numeric(10,2),
  accommodation_aed     numeric(12,2) not null default 0,
  cleaning_fee_aed      numeric(10,2) not null default 0,
  extra_fees_aed        numeric(10,2) not null default 0,
  tourism_dirham_aed    numeric(10,2) not null default 0,
  channel_commission_aed numeric(10,2) not null default 0,
  gross_total_aed       numeric(12,2) not null default 0,
  payout_expected_aed   numeric(12,2),

  damage_deposit_aed    numeric(10,2) not null default 0,
  damage_deposit_status deposit_status not null default 'not_collected',

  quoted_currency       char(3) not null default 'AED',
  fx_rate_to_aed        numeric(12,6) not null default 1,

  -- Permit in force at the time of booking, captured for the audit trail.
  permit_number_at_booking text,

  guest_message         text,
  internal_notes        text,
  cancelled_on          date,
  cancellation_reason   text,
  created_by            uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (check_out > check_in),
  check (adults + children > 0)
);
create index bookings_unit_idx on bookings(unit_id);
create index bookings_dates_idx on bookings(check_in, check_out);
create index bookings_status_idx on bookings(status);
create index bookings_guest_idx on bookings(guest_id);
create trigger bookings_touch before update on bookings
  for each row execute function pms.touch_updated_at();

-- No double-booking a unit for confirmed/in-house stays. Half-open range:
-- one guest checking out on the same day another checks in is allowed.
alter table bookings add constraint bookings_no_overlap
  exclude using gist (
    unit_id with =,
    daterange(check_in, check_out, '[)') with &&
  ) where (status in ('tentative','confirmed','checked_in'));

-- Confirming a booking requires a live DET permit and snapshots it.
create or replace function pms.enforce_permit_before_booking()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('tentative','confirmed','checked_in') then
    if not pms.unit_has_valid_permit(new.unit_id, new.check_in) then
      raise exception
        'Booking for unit % rejected: no valid DET holiday home permit covering check-in date %',
        new.unit_id, new.check_in
        using errcode = 'check_violation';
    end if;
    if new.permit_number_at_booking is null then
      new.permit_number_at_booking := pms.unit_permit_number(new.unit_id);
    end if;
  end if;
  return new;
end;
$$;

create trigger bookings_permit_gate
  before insert or update of status, unit_id, check_in on bookings
  for each row execute function pms.enforce_permit_before_booking();

-- Guest registration records. Dubai holiday home operators must keep records
-- of every guest staying in the unit, not just the booker.
create table booking_guests (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references bookings(id) on delete cascade,
  guest_id        uuid references guests(id) on delete set null,
  full_name       text not null,
  nationality     text,
  date_of_birth   date,
  passport_number text,
  emirates_id     text,
  is_lead_guest   boolean not null default false,
  id_document_id  uuid,                        -- FK added in 0008 (documents)
  registered_at   timestamptz,
  registered_by   uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index booking_guests_booking_idx on booking_guests(booking_id);

-- ---------------------------------------------------------------------------
-- Calendar blocks: bookings, maintenance, owner stays, channel-sync holds
-- ---------------------------------------------------------------------------
create table availability_blocks (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      block_reason not null default 'blocked',
  booking_id  uuid references bookings(id) on delete cascade,
  source_channel sales_channel,
  note        text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date > start_date)
);
create index availability_blocks_unit_idx on availability_blocks(unit_id, start_date, end_date);

-- ---------------------------------------------------------------------------
-- Housekeeping / turnover, scheduled into the checkout -> next check-in gap
-- ---------------------------------------------------------------------------
create table housekeeping_tasks (
  id             uuid primary key default gen_random_uuid(),
  unit_id        uuid not null references units(id) on delete cascade,
  booking_id     uuid references bookings(id) on delete set null,
  next_booking_id uuid references bookings(id) on delete set null,
  kind           housekeeping_kind not null default 'turnover',
  status         task_status not null default 'pending',
  scheduled_start timestamptz not null,
  scheduled_end  timestamptz,
  assigned_to    uuid references profiles(id) on delete set null,
  checklist      jsonb not null default '[]'::jsonb,
  started_at     timestamptz,
  completed_at   timestamptz,
  verified_by    uuid references profiles(id) on delete set null,
  supplies_used  jsonb,
  cost_aed       numeric(10,2),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index housekeeping_unit_idx on housekeeping_tasks(unit_id, scheduled_start);
create index housekeeping_assignee_idx on housekeeping_tasks(assigned_to)
  where status in ('pending','assigned','in_progress');
create trigger housekeeping_touch before update on housekeeping_tasks
  for each row execute function pms.touch_updated_at();
