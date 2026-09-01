-- ============================================================================
-- D|R|P PMS - 0004 Long-term leasing (Ejari-ready)
--
-- Dubai specifics baked in:
--   * Ejari registration number / expiry tracked on the lease itself
--   * Declared occupants list + 30-day Ejari data-currency rule (2026)
--   * Cheque-based payment schedules (1/2/4/6/12 cheques) with bounce tracking
--   * Rent-increase notices referencing the RERA Smart Rental Index
--   * E-signature fields left provider-agnostic so UAE Pass / Dubai REST
--     can be wired in later without a schema change
-- ============================================================================

create table tenants (
  id                  uuid primary key default gen_random_uuid(),
  is_company          boolean not null default false,
  full_name           text not null,
  company_trade_licence text,
  email               text,
  phone               text,
  whatsapp            text,
  nationality         text,
  date_of_birth       date,
  emirates_id         text,
  emirates_id_expiry  date,
  passport_number     text,
  passport_expiry     date,
  visa_number         text,
  visa_expiry         date,
  employer            text,
  occupation          text,
  trn                 text,
  emergency_contact_name  text,
  emergency_contact_phone text,
  preferred_locale    text not null default 'en',
  preferred_channel   message_channel not null default 'whatsapp',
  profile_id          uuid references profiles(id) on delete set null,  -- portal login
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index tenants_profile_idx on tenants(profile_id);
create trigger tenants_touch before update on tenants
  for each row execute function pms.touch_updated_at();

create table leases (
  id                    uuid primary key default gen_random_uuid(),
  lease_number          text unique not null,
  unit_id               uuid not null references units(id) on delete restrict,
  tenant_id             uuid not null references tenants(id) on delete restrict,
  status                lease_status not null default 'draft',

  start_date            date not null,
  end_date              date not null,
  annual_rent_aed       numeric(12,2) not null check (annual_rent_aed >= 0),
  contract_value_aed    numeric(12,2),          -- if term <> 12 months
  security_deposit_aed  numeric(12,2) not null default 0,
  deposit_status        deposit_status not null default 'not_collected',

  payment_method        rent_payment_method not null default 'cheque',
  installment_count     integer not null default 1
                          check (installment_count in (1,2,3,4,6,12)),
  ejari_fee_aed         numeric(10,2),
  agency_fee_aed        numeric(10,2),

  -- Ejari (RERA/DLD tenancy registration)
  ejari_status          ejari_status not null default 'not_registered',
  ejari_contract_number text,
  ejari_registered_on   date,
  ejari_expiry          date,
  -- Last time the declared-occupant list was pushed to Ejari. The 30-day
  -- data-currency rule is measured from occupant changes against this date.
  ejari_occupants_synced_at timestamptz,

  -- E-signature: provider-agnostic. UAE Pass / Dubai REST plugs in here.
  signature_provider    text,
  signature_reference   text,
  tenant_signed_at      timestamptz,
  landlord_signed_at    timestamptz,

  renewal_of_lease_id   uuid references leases(id) on delete set null,
  notice_period_days    integer not null default 90,
  agent_id              uuid references profiles(id) on delete set null,
  managed_under_agreement_id uuid references management_agreements(id) on delete set null,

  move_in_date          date,
  move_out_date         date,
  terminated_on         date,
  termination_reason    text,

  notes                 text,
  created_by            uuid references profiles(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  check (end_date > start_date)
);
create index leases_unit_idx on leases(unit_id);
create index leases_tenant_idx on leases(tenant_id);
create index leases_status_idx on leases(status);
create index leases_expiry_idx on leases(end_date) where status in ('active','expiring');
create index leases_ejari_expiry_idx on leases(ejari_expiry) where ejari_status = 'registered';
create trigger leases_touch before update on leases
  for each row execute function pms.touch_updated_at();

-- A unit may not have two overlapping non-terminal leases.
alter table leases add constraint leases_no_overlap
  exclude using gist (
    unit_id with =,
    daterange(start_date, end_date, '[]') with &&
  ) where (status in ('pending_signature','active','expiring','renewed'));

-- ---------------------------------------------------------------------------
-- Declared occupants (Ejari 2026 data-currency requirement)
-- Any add/remove must be reflected in Ejari within company_settings
-- .ejari_occupant_update_days (default 30) days.
-- ---------------------------------------------------------------------------
create table lease_occupants (
  id             uuid primary key default gen_random_uuid(),
  lease_id       uuid not null references leases(id) on delete cascade,
  full_name      text not null,
  relationship   text,                       -- self, spouse, child, flatmate, staff
  nationality    text,
  date_of_birth  date,
  emirates_id    text,
  passport_number text,
  is_primary     boolean not null default false,
  declared_on    date not null default current_date,
  removed_on     date,
  -- Set when this specific occupant record has been reflected in Ejari.
  ejari_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index lease_occupants_lease_idx on lease_occupants(lease_id) where removed_on is null;
create index lease_occupants_unsynced_idx on lease_occupants(lease_id)
  where ejari_synced_at is null and removed_on is null;
create trigger lease_occupants_touch before update on lease_occupants
  for each row execute function pms.touch_updated_at();

-- Changing the occupant list invalidates the lease-level Ejari sync stamp,
-- which is what makes the compliance flag light up.
create or replace function pms.invalidate_ejari_occupant_sync()
returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  if tg_op = 'DELETE' then
    target := old.lease_id;
  else
    target := new.lease_id;
  end if;

  update leases
     set ejari_occupants_synced_at = null
   where id = target
     and ejari_occupants_synced_at is not null;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger lease_occupants_invalidate_sync
  after insert or update of full_name, emirates_id, passport_number, removed_on
     or delete on lease_occupants
  for each row execute function pms.invalidate_ejari_occupant_sync();

-- ---------------------------------------------------------------------------
-- Rent / cheque schedule
-- ---------------------------------------------------------------------------
create table lease_installments (
  id              uuid primary key default gen_random_uuid(),
  lease_id        uuid not null references leases(id) on delete cascade,
  installment_no  integer not null,
  due_date        date not null,
  amount_aed      numeric(12,2) not null check (amount_aed >= 0),
  method          rent_payment_method not null default 'cheque',
  cheque_number   text,
  cheque_bank     text,
  cheque_date     date,
  status          installment_status not null default 'scheduled',
  amount_paid_aed numeric(12,2) not null default 0,
  presented_on    date,
  cleared_on      date,
  bounced_on      date,
  bounce_reason   text,
  bounce_charge_aed numeric(10,2),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (lease_id, installment_no)
);
create index lease_installments_due_idx on lease_installments(due_date)
  where status in ('scheduled','presented','part_paid');
create index lease_installments_bounced_idx on lease_installments(lease_id) where status = 'bounced';
create trigger lease_installments_touch before update on lease_installments
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Security deposit movements
-- ---------------------------------------------------------------------------
create table deposit_transactions (
  id          uuid primary key default gen_random_uuid(),
  lease_id    uuid not null references leases(id) on delete cascade,
  kind        deposit_txn_kind not null,
  amount_aed  numeric(12,2) not null check (amount_aed > 0),
  occurred_on date not null default current_date,
  reason      text,                        -- required for deductions
  recorded_by uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  check (kind <> 'deducted' or reason is not null)
);
create index deposit_txn_lease_idx on deposit_transactions(lease_id);

-- ---------------------------------------------------------------------------
-- Rent increase notices (RERA Smart Rental Index)
-- The permitted increase % from the index is stored alongside the notice so
-- the calculation is auditable years later even if the index changes.
-- ---------------------------------------------------------------------------
create table rent_increase_notices (
  id                     uuid primary key default gen_random_uuid(),
  lease_id               uuid not null references leases(id) on delete cascade,
  current_rent_aed       numeric(12,2) not null,
  proposed_rent_aed      numeric(12,2) not null,
  increase_pct           numeric(6,2) generated always as (
                            case when current_rent_aed > 0
                              then round(((proposed_rent_aed - current_rent_aed) / current_rent_aed) * 100, 2)
                              else 0 end
                         ) stored,
  -- Snapshot of the RERA Smart Rental Index / Rental Calculator result
  rera_index_rent_aed    numeric(12,2),
  rera_permitted_pct     numeric(6,2),
  rera_index_checked_on  date,
  rera_reference         text,

  notice_date            date not null default current_date,
  effective_date         date not null,
  required_notice_days   integer not null default 90,
  delivered_via          message_channel,
  status                 notice_status not null default 'draft',
  issued_by              uuid references profiles(id) on delete set null,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- Legally required notice period must be respected before it can take effect
  check (effective_date >= notice_date + required_notice_days)
);
create index rent_increase_lease_idx on rent_increase_notices(lease_id);
create trigger rent_increase_touch before update on rent_increase_notices
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- General lease notices: renewal, non-renewal, termination, eviction
-- ---------------------------------------------------------------------------
create table lease_notices (
  id                   uuid primary key default gen_random_uuid(),
  lease_id             uuid not null references leases(id) on delete cascade,
  kind                 notice_kind not null,
  status               notice_status not null default 'draft',
  issued_on            date not null default current_date,
  effective_on         date not null,
  required_notice_days integer not null default 90,
  grounds              text,                  -- eviction grounds (Law 26/2007 art.25 etc.)
  delivered_via        message_channel,
  delivered_on         date,
  acknowledged_on      date,
  issued_by            uuid references profiles(id) on delete set null,
  body                 text,                  -- generated document body
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index lease_notices_lease_idx on lease_notices(lease_id);
create trigger lease_notices_touch before update on lease_notices
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- UAEDDS (UAE Direct Debit System) integration point.
-- Not implemented now - the mandate record exists so switching a lease from
-- cheques to direct debit later needs no migration.
-- ---------------------------------------------------------------------------
create table direct_debit_mandates (
  id                 uuid primary key default gen_random_uuid(),
  lease_id           uuid not null references leases(id) on delete cascade,
  provider           text not null default 'uaedds',
  mandate_reference  text,
  payer_iban         text,
  payer_bank         text,
  amount_aed         numeric(12,2),
  frequency_months   integer not null default 1,
  start_date         date,
  end_date           date,
  status             text not null default 'draft',
  registered_on      date,
  last_collection_on date,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index dd_mandates_lease_idx on direct_debit_mandates(lease_id);
create trigger dd_mandates_touch before update on direct_debit_mandates
  for each row execute function pms.touch_updated_at();
