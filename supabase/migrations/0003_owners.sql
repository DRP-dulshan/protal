-- ============================================================================
-- D|R|P PMS - 0003 Owners, ownership, management agreements, owner portal link
-- ============================================================================

create table owners (
  id                   uuid primary key default gen_random_uuid(),
  is_company           boolean not null default false,
  full_name            text not null,                 -- individual name or company name
  company_trade_licence text,
  email                text,
  phone                text,
  whatsapp             text,
  nationality          text,
  emirates_id          text,
  emirates_id_expiry   date,
  passport_number      text,
  passport_expiry      date,
  trn                  text,                          -- if VAT-registered
  address_line         text,
  country_of_residence text,
  preferred_locale     text not null default 'en',
  preferred_channel    message_channel not null default 'whatsapp',
  is_active            boolean not null default true,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index owners_name_idx on owners using gin (to_tsvector('simple', full_name));
create trigger owners_touch before update on owners
  for each row execute function pms.touch_updated_at();

-- Bank details are sensitive: separate table so RLS can lock it down harder
-- than the owner record itself.
create table owner_bank_accounts (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references owners(id) on delete cascade,
  account_holder text not null,
  bank_name      text not null,
  branch         text,
  iban           text not null,
  swift_bic      text,
  currency       char(3) not null default 'AED',
  is_primary     boolean not null default true,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index owner_bank_primary_idx on owner_bank_accounts(owner_id)
  where is_primary and is_active;
create trigger owner_bank_touch before update on owner_bank_accounts
  for each row execute function pms.touch_updated_at();

-- Link an owner record to a portal login. An owner may have several logins
-- (e.g. spouse, family office) and one login may cover several owner records.
create table owner_users (
  owner_id   uuid not null references owners(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  can_approve_maintenance boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (owner_id, profile_id)
);
create index owner_users_profile_idx on owner_users(profile_id);

-- Fractional ownership supported: percentages per unit must not exceed 100.
create table unit_ownerships (
  id                uuid primary key default gen_random_uuid(),
  unit_id           uuid not null references units(id) on delete cascade,
  owner_id          uuid not null references owners(id) on delete restrict,
  ownership_pct     numeric(5,2) not null default 100.00
                      check (ownership_pct > 0 and ownership_pct <= 100),
  title_deed_number text,
  purchase_date     date,
  purchase_price_aed numeric(14,2),
  is_primary_contact boolean not null default true,
  start_date        date not null default current_date,
  end_date          date,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index unit_ownerships_unit_idx on unit_ownerships(unit_id) where end_date is null;
create index unit_ownerships_owner_idx on unit_ownerships(owner_id) where end_date is null;
create trigger unit_ownerships_touch before update on unit_ownerships
  for each row execute function pms.touch_updated_at();

-- Guard: active ownership shares for a unit must total <= 100%.
create or replace function pms.check_ownership_total()
returns trigger
language plpgsql
as $$
declare
  total numeric(6,2);
begin
  select coalesce(sum(ownership_pct), 0) into total
  from unit_ownerships
  where unit_id = new.unit_id
    and end_date is null
    and id <> new.id;

  if total + new.ownership_pct > 100.00 then
    raise exception 'Ownership for unit % would total %%%, exceeding 100%%',
      new.unit_id, total + new.ownership_pct;
  end if;
  return new;
end;
$$;

create trigger unit_ownerships_total_check
  before insert or update on unit_ownerships
  for each row when (new.end_date is null)
  execute function pms.check_ownership_total();

-- ---------------------------------------------------------------------------
-- Management agreements: the commercial contract between D|R|P and the owner.
-- Drives the management fee applied on owner statements.
-- ---------------------------------------------------------------------------
create table management_agreements (
  id                 uuid primary key default gen_random_uuid(),
  agreement_number   text unique,
  unit_id            uuid not null references units(id) on delete cascade,
  owner_id           uuid not null references owners(id) on delete restrict,
  service_mode       operating_mode not null default 'long_term',
  start_date         date not null,
  end_date           date not null,
  commission_pct     numeric(5,2),                 -- % of collected revenue
  fixed_fee_aed      numeric(12,2),                -- alternative flat fee
  fee_vat_applicable boolean not null default true, -- management fee is a taxable service
  leasing_commission_pct numeric(5,2),             -- one-off, on new tenancy
  auto_renew         boolean not null default true,
  notice_days        integer not null default 60,
  is_active          boolean not null default true,
  terminated_on      date,
  termination_reason text,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date > start_date),
  check (commission_pct is not null or fixed_fee_aed is not null)
);
create index mgmt_agreements_unit_idx on management_agreements(unit_id) where is_active;
create index mgmt_agreements_owner_idx on management_agreements(owner_id) where is_active;
create index mgmt_agreements_expiry_idx on management_agreements(end_date) where is_active;
create trigger mgmt_agreements_touch before update on management_agreements
  for each row execute function pms.touch_updated_at();
