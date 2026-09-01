-- ============================================================================
-- D|R|P PMS - 0002 Identity, company settings, property hierarchy, units
-- ============================================================================

-- ---------------------------------------------------------------------------
-- profiles : one row per auth.users row. Role lives here and drives RLS.
-- ---------------------------------------------------------------------------
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  role          app_role not null default 'tenant',
  full_name     text not null default '',
  email         text,
  phone         text,
  whatsapp      text,
  avatar_path   text,
  locale        text not null default 'en',            -- 'en' | 'ar'
  job_title     text,
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index profiles_role_idx on profiles(role) where is_active;
create trigger profiles_touch before update on profiles
  for each row execute function pms.touch_updated_at();

-- Auto-provision a profile whenever Supabase Auth creates a user.
create or replace function pms.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  insert into public.profiles (id, email, full_name, phone, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    new.raw_user_meta_data->>'phone',
    coalesce((new.raw_user_meta_data->>'role')::app_role, 'tenant')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function pms.handle_new_user();

-- ---------------------------------------------------------------------------
-- company_settings : single-row configuration for the D|R|P entity.
-- Management fee %, VAT rate and notice periods are configurable, never
-- hardcoded in application logic.
-- ---------------------------------------------------------------------------
create table company_settings (
  id                          boolean primary key default true check (id),
  legal_name                  text not null default 'D|R|P Real Estate',
  trade_name                  text not null default 'D|R|P',
  trade_licence_number        text,
  trade_licence_expiry        date,
  rera_broker_number          text,
  trn                         text,                        -- UAE VAT registration number
  registered_address          text,
  emirate                     emirate not null default 'dubai',
  phone                       text,
  email                       text,
  website                     text,

  base_currency               char(3) not null default 'AED',
  vat_rate                    numeric(5,4) not null default 0.0500,   -- 5% UAE VAT
  default_management_fee_pct  numeric(5,2) not null default 8.00,
  default_str_management_fee_pct numeric(5,2) not null default 20.00,

  -- Regulatory notice windows (days). Editable by Super Admin.
  rent_increase_notice_days   integer not null default 90,
  lease_renewal_notice_days   integer not null default 90,
  ejari_occupant_update_days  integer not null default 30,  -- 2026 Ejari currency rule
  permit_renewal_reminder_days integer not null default 60,  -- DET permit
  document_alert_days         integer[] not null default '{60,30,7}',

  -- Owner approval threshold for maintenance spend (AED).
  maintenance_owner_approval_threshold numeric(12,2) not null default 1000.00,

  invoice_prefix              text not null default 'DRP-INV',
  invoice_next_number         integer not null default 1,
  statement_prefix            text not null default 'DRP-STM',
  lease_prefix                text not null default 'DRP-LSE',
  booking_prefix              text not null default 'DRP-BKG',
  ticket_prefix               text not null default 'DRP-MNT',

  brand_primary_hex           text not null default '#0F172A',
  brand_accent_hex            text not null default '#C6A15B',
  logo_path                   text,

  default_locale              text not null default 'en',
  enabled_locales             text[] not null default '{en,ar}',
  display_currencies          char(3)[] not null default '{AED,USD,EUR,GBP}',

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create trigger company_settings_touch before update on company_settings
  for each row execute function pms.touch_updated_at();

insert into company_settings (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Property hierarchy: community -> property (building/complex) -> unit
-- ---------------------------------------------------------------------------
create table communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  name_ar      text,
  emirate      emirate not null default 'dubai',
  city         text not null default 'Dubai',
  dld_community_number text,
  latitude     numeric(10,7),
  longitude    numeric(10,7),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (name, emirate)
);
create trigger communities_touch before update on communities
  for each row execute function pms.touch_updated_at();

create table properties (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid references communities(id) on delete set null,
  name                   text not null,
  name_ar                text,
  kind                   property_kind not null default 'building',
  address_line           text,
  makani_number          text,                  -- Dubai Makani geo-address
  plot_number            text,
  developer_name         text,
  year_built             integer,
  floors                 integer,
  total_units            integer,

  -- Owners' association / Mollak (service charges)
  owners_association_name text,
  mollak_property_id      text,
  oa_management_company   text,

  building_noc_required   boolean not null default true,  -- for holiday-home use
  amenities               text[] not null default '{}',
  cover_image_path        text,
  is_active               boolean not null default true,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index properties_community_idx on properties(community_id);
create trigger properties_touch before update on properties
  for each row execute function pms.touch_updated_at();

create table units (
  id                    uuid primary key default gen_random_uuid(),
  property_id           uuid not null references properties(id) on delete restrict,
  unit_number           text not null,
  reference_code        text unique,                 -- internal D|R|P code
  kind                  unit_kind not null default 'apartment',
  floor                 text,
  bedrooms              numeric(3,1) not null default 1,   -- 0 = studio, 1.5 etc.
  bathrooms             numeric(3,1) not null default 1,
  size_sqft             numeric(10,2),
  size_sqm              numeric(10,2) generated always as (round(size_sqft * 0.09290304, 2)) stored,
  furnishing            furnishing_status not null default 'unfurnished',
  parking_spaces        integer not null default 0,
  parking_numbers       text[],
  balcony               boolean not null default false,
  view_description      text,
  amenities             text[] not null default '{}',

  -- Dubai-specific identifiers
  dewa_premise_number   text,
  dewa_account_number   text,
  title_deed_number     text,
  makani_number         text,
  dld_property_number   text,
  mollak_unit_id        text,

  operating_mode        operating_mode not null default 'long_term',
  status                unit_status not null default 'vacant',

  -- Indicative pricing (actual figures live on leases / bookings)
  target_annual_rent_aed numeric(12,2),
  base_nightly_rate_aed  numeric(10,2),
  min_nights             integer not null default 1,
  max_guests             integer,

  handover_date          date,
  is_active              boolean not null default true,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (property_id, unit_number)
);
create index units_property_idx on units(property_id);
create index units_status_idx on units(status) where is_active;
create index units_mode_idx on units(operating_mode) where is_active;
create trigger units_touch before update on units
  for each row execute function pms.touch_updated_at();

create table unit_media (
  id          uuid primary key default gen_random_uuid(),
  unit_id     uuid not null references units(id) on delete cascade,
  bucket      text not null default 'media',
  storage_path text not null,
  caption     text,
  sort_order  integer not null default 0,
  is_cover    boolean not null default false,
  uploaded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index unit_media_unit_idx on unit_media(unit_id, sort_order);
create unique index unit_media_one_cover_idx on unit_media(unit_id) where is_cover;

-- ---------------------------------------------------------------------------
-- Staff scoping: which units/properties a property manager or agent may see.
-- Super admin / finance bypass this; everyone else is scoped.
-- ---------------------------------------------------------------------------
create table staff_property_assignments (
  profile_id  uuid not null references profiles(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (profile_id, property_id)
);

create table staff_unit_assignments (
  profile_id  uuid not null references profiles(id) on delete cascade,
  unit_id     uuid not null references units(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (profile_id, unit_id)
);
