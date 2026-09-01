-- ============================================================================
-- D|R|P PMS - 0006 Finance
--
-- Rules encoded here:
--   * AED is the base currency for every stored amount. Foreign currency is a
--     display concern (quoted_currency + fx_rate on the source record).
--   * VAT applicability is PER LINE ITEM, not per document. Long-term
--     residential rent is normally exempt; management fees, commission and
--     furnishing services are normally standard-rated. The accountant
--     configures the default per GL category and can override per line.
--   * Owner payout = collected income - management fee - owner expenses - VAT
--     where applicable. Every component traces back to a ledger entry.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Chart of accounts (simplified, configurable by Finance)
-- ---------------------------------------------------------------------------
create table gl_categories (
  id                     uuid primary key default gen_random_uuid(),
  code                   text unique not null,
  name                   text not null,
  name_ar                text,
  direction              ledger_direction not null,
  -- Default VAT treatment. Overridable on each line item.
  default_vat_applicable boolean not null default true,
  -- Does this hit the owner statement (recharged to / paid by the owner)?
  affects_owner_statement boolean not null default true,
  is_active              boolean not null default true,
  sort_order             integer not null default 100,
  created_at             timestamptz not null default now()
);

insert into gl_categories (code, name, direction, default_vat_applicable, affects_owner_statement, sort_order) values
  ('INC-RENT',       'Long-term rent',            'income',  false, true,  10),
  ('INC-BOOKING',    'Short-term booking revenue','income',  true,  true,  20),
  ('INC-CLEANING',   'Cleaning fee income',       'income',  true,  true,  30),
  ('INC-OTHER',      'Other income',              'income',  true,  true,  90),
  ('EXP-MGMT-FEE',   'Management fee',            'expense', true,  true,  100),
  ('EXP-COMMISSION', 'Leasing commission',        'expense', true,  true,  110),
  ('EXP-MAINT',      'Maintenance & repairs',     'expense', true,  true,  120),
  ('EXP-HOUSEKEEP',  'Housekeeping & laundry',    'expense', true,  true,  130),
  ('EXP-DEWA',       'DEWA utilities',            'expense', false, true,  140),
  ('EXP-CHILLER',    'Chiller / district cooling','expense', true,  true,  145),
  ('EXP-SERVICE-CHG','OA service charges (Mollak)','expense',true,  true,  150),
  ('EXP-INSURANCE',  'Insurance',                 'expense', true,  true,  160),
  ('EXP-EJARI',      'Ejari & government fees',   'expense', false, true,  170),
  ('EXP-PERMIT',     'DET permit & NOC fees',     'expense', false, true,  175),
  ('EXP-TOURISM-DH', 'Tourism Dirham fee',        'expense', false, true,  180),
  ('EXP-CHANNEL',    'OTA channel commission',    'expense', false, true,  185),
  ('EXP-FURNISH',    'Furnishing & interior design','expense',true, true,  190),
  ('EXP-OTHER',      'Other expenses',            'expense', true,  true,  900)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Ledger: the single source of truth behind owner statements and P&L.
-- Every income/expense event in the system writes exactly one entry here.
-- ---------------------------------------------------------------------------
create table ledger_entries (
  id               uuid primary key default gen_random_uuid(),
  entry_date       date not null default current_date,
  unit_id          uuid references units(id) on delete set null,
  owner_id         uuid references owners(id) on delete set null,
  category_id      uuid not null references gl_categories(id) on delete restrict,
  direction        ledger_direction not null,
  description      text not null,

  -- Amounts are always AED and always VAT-exclusive in `amount_aed`.
  amount_aed       numeric(14,2) not null check (amount_aed >= 0),
  vat_applicable   boolean not null default false,
  vat_rate         numeric(5,4) not null default 0,
  vat_amount_aed   numeric(14,2) not null default 0,
  total_aed        numeric(14,2) generated always as (amount_aed + vat_amount_aed) stored,

  -- Provenance: what created this entry
  source_table     text,
  source_id        uuid,
  lease_id         uuid references leases(id) on delete set null,
  booking_id       uuid references bookings(id) on delete set null,
  invoice_id       uuid,                      -- FK added after invoices exists
  statement_id     uuid,                      -- set once included in a statement

  is_owner_visible boolean not null default true,
  recorded_by      uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (vat_applicable or vat_amount_aed = 0)
);
create index ledger_unit_date_idx on ledger_entries(unit_id, entry_date);
create index ledger_owner_date_idx on ledger_entries(owner_id, entry_date);
create index ledger_statement_idx on ledger_entries(statement_id);
create index ledger_source_idx on ledger_entries(source_table, source_id);
create trigger ledger_touch before update on ledger_entries
  for each row execute function pms.touch_updated_at();

-- Compute VAT from the rate when the caller does not supply the amount.
create or replace function pms.apply_vat()
returns trigger
language plpgsql
as $$
begin
  if not new.vat_applicable then
    new.vat_rate := 0;
    new.vat_amount_aed := 0;
  else
    if new.vat_rate is null or new.vat_rate = 0 then
      select vat_rate into new.vat_rate from company_settings where id;
    end if;
    if new.vat_amount_aed is null or new.vat_amount_aed = 0 then
      new.vat_amount_aed := round(new.amount_aed * new.vat_rate, 2);
    end if;
  end if;
  return new;
end;
$$;

create trigger ledger_apply_vat before insert or update on ledger_entries
  for each row execute function pms.apply_vat();

-- ---------------------------------------------------------------------------
-- Invoices (tax-compliant sequential numbering)
-- ---------------------------------------------------------------------------
create table invoices (
  id             uuid primary key default gen_random_uuid(),
  invoice_number text unique not null,
  kind           invoice_kind not null,
  direction      invoice_direction not null default 'receivable',
  status         invoice_status not null default 'draft',

  party_kind     party_kind not null,
  party_id       uuid not null,               -- polymorphic: owner/tenant/guest/vendor
  party_name     text not null,               -- snapshot for the printed document
  party_trn      text,

  unit_id        uuid references units(id) on delete set null,
  lease_id       uuid references leases(id) on delete set null,
  booking_id     uuid references bookings(id) on delete set null,

  issue_date     date not null default current_date,
  due_date       date,
  currency       char(3) not null default 'AED',

  subtotal_aed   numeric(14,2) not null default 0,
  vat_total_aed  numeric(14,2) not null default 0,
  total_aed      numeric(14,2) not null default 0,
  paid_aed       numeric(14,2) not null default 0,
  balance_aed    numeric(14,2) generated always as (total_aed - paid_aed) stored,

  place_of_supply text not null default 'Dubai, UAE',
  notes          text,
  terms          text,
  pdf_path       text,
  voided_reason  text,
  created_by     uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index invoices_party_idx on invoices(party_kind, party_id);
create index invoices_unit_idx on invoices(unit_id);
create index invoices_status_idx on invoices(status) where status in ('issued','part_paid','overdue');
create trigger invoices_touch before update on invoices
  for each row execute function pms.touch_updated_at();

create table invoice_lines (
  id               uuid primary key default gen_random_uuid(),
  invoice_id       uuid not null references invoices(id) on delete cascade,
  line_no          integer not null default 1,
  description      text not null,
  category_id      uuid references gl_categories(id) on delete set null,
  quantity         numeric(10,2) not null default 1,
  unit_price_aed   numeric(14,2) not null default 0,
  discount_aed     numeric(14,2) not null default 0,
  -- Per-line VAT flag: this is what makes exempt residential rent and
  -- standard-rated management fees coexist on one document.
  vat_applicable   boolean not null default true,
  vat_rate         numeric(5,4) not null default 0.05,
  line_subtotal_aed numeric(14,2) generated always as
                     (round(quantity * unit_price_aed - discount_aed, 2)) stored,
  line_vat_aed     numeric(14,2) not null default 0,
  line_total_aed   numeric(14,2) not null default 0,
  created_at       timestamptz not null default now(),
  unique (invoice_id, line_no)
);
create index invoice_lines_invoice_idx on invoice_lines(invoice_id);

create or replace function pms.compute_invoice_line()
returns trigger
language plpgsql
as $$
declare
  sub numeric(14,2);
begin
  sub := round(new.quantity * new.unit_price_aed - new.discount_aed, 2);
  if new.vat_applicable then
    if new.vat_rate is null then
      select vat_rate into new.vat_rate from company_settings where id;
    end if;
    new.line_vat_aed := round(sub * new.vat_rate, 2);
  else
    new.vat_rate := 0;
    new.line_vat_aed := 0;
  end if;
  new.line_total_aed := sub + new.line_vat_aed;
  return new;
end;
$$;

create trigger invoice_lines_compute before insert or update on invoice_lines
  for each row execute function pms.compute_invoice_line();

create or replace function pms.recalc_invoice_totals()
returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  target := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;

  update invoices i
     set subtotal_aed  = coalesce(t.sub, 0),
         vat_total_aed = coalesce(t.vat, 0),
         total_aed     = coalesce(t.sub, 0) + coalesce(t.vat, 0)
    from (
      select sum(line_subtotal_aed) as sub, sum(line_vat_aed) as vat
      from invoice_lines where invoice_id = target
    ) t
   where i.id = target;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger invoice_lines_rollup
  after insert or update or delete on invoice_lines
  for each row execute function pms.recalc_invoice_totals();

alter table ledger_entries
  add constraint ledger_invoice_fk
  foreign key (invoice_id) references invoices(id) on delete set null;

-- Sequential, gap-free invoice numbering (UAE tax requirement).
create or replace function pms.next_invoice_number()
returns text
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  prefix text;
  n      integer;
begin
  update company_settings
     set invoice_next_number = invoice_next_number + 1
   where id
  returning invoice_prefix, invoice_next_number - 1 into prefix, n;

  return prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Payments + reconciliation
-- ---------------------------------------------------------------------------
create table payments (
  id                uuid primary key default gen_random_uuid(),
  payment_reference text unique not null,
  direction         payment_direction not null,
  status            payment_status not null default 'pending',
  method            rent_payment_method not null default 'bank_transfer',

  party_kind        party_kind not null,
  party_id          uuid,
  party_name        text,

  amount_aed        numeric(14,2) not null check (amount_aed > 0),
  currency          char(3) not null default 'AED',
  fx_rate_to_aed    numeric(12,6) not null default 1,

  paid_on           date not null default current_date,
  -- Provider is abstracted: never branch on this in business logic.
  provider          text,
  provider_reference text,
  bank_reference    text,
  reconciled_at     timestamptz,
  reconciled_by     uuid references profiles(id) on delete set null,

  unit_id           uuid references units(id) on delete set null,
  lease_id          uuid references leases(id) on delete set null,
  booking_id        uuid references bookings(id) on delete set null,
  installment_id    uuid references lease_installments(id) on delete set null,

  notes             text,
  recorded_by       uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index payments_party_idx on payments(party_kind, party_id);
create index payments_unreconciled_idx on payments(paid_on) where reconciled_at is null;
create trigger payments_touch before update on payments
  for each row execute function pms.touch_updated_at();

create table payment_allocations (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references payments(id) on delete cascade,
  invoice_id   uuid not null references invoices(id) on delete cascade,
  amount_aed   numeric(14,2) not null check (amount_aed > 0),
  created_at   timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create or replace function pms.recalc_invoice_paid()
returns trigger
language plpgsql
as $$
declare
  target uuid;
  paid   numeric(14,2);
  tot    numeric(14,2);
begin
  target := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;

  select coalesce(sum(amount_aed), 0) into paid
  from payment_allocations where invoice_id = target;

  select total_aed into tot from invoices where id = target;

  update invoices
     set paid_aed = paid,
         status = case
           when status = 'void' then 'void'
           when paid >= tot and tot > 0 then 'paid'
           when paid > 0 then 'part_paid'
           when due_date is not null and due_date < current_date then 'overdue'
           else status
         end
   where id = target;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger payment_allocations_rollup
  after insert or update or delete on payment_allocations
  for each row execute function pms.recalc_invoice_paid();

-- ---------------------------------------------------------------------------
-- Mollak / owners' association service charges, tracked against the unit
-- ---------------------------------------------------------------------------
create table service_charge_invoices (
  id                 uuid primary key default gen_random_uuid(),
  unit_id            uuid not null references units(id) on delete cascade,
  mollak_invoice_number text,
  oa_name            text,
  management_company text,
  period_start       date not null,
  period_end         date not null,
  amount_aed         numeric(14,2) not null,
  vat_aed            numeric(14,2) not null default 0,
  total_aed          numeric(14,2) generated always as (amount_aed + vat_aed) stored,
  rate_per_sqft_aed  numeric(10,4),
  due_date           date,
  paid_on            date,
  status             invoice_status not null default 'issued',
  ledger_entry_id    uuid references ledger_entries(id) on delete set null,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (period_end > period_start)
);
create index service_charges_unit_idx on service_charge_invoices(unit_id, period_start);
create trigger service_charges_touch before update on service_charge_invoices
  for each row execute function pms.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Owner statements
-- Lines are snapshotted from the ledger so a re-issued statement can never
-- silently change history.
-- ---------------------------------------------------------------------------
create table owner_statements (
  id                 uuid primary key default gen_random_uuid(),
  statement_number   text unique not null,
  owner_id           uuid not null references owners(id) on delete restrict,
  period_start       date not null,
  period_end         date not null,
  status             statement_status not null default 'draft',

  gross_income_aed   numeric(14,2) not null default 0,
  total_expenses_aed numeric(14,2) not null default 0,
  management_fee_aed numeric(14,2) not null default 0,
  vat_total_aed      numeric(14,2) not null default 0,
  net_payout_aed     numeric(14,2) not null default 0,
  opening_balance_aed numeric(14,2) not null default 0,
  closing_balance_aed numeric(14,2) not null default 0,

  issued_on          date,
  approved_by        uuid references profiles(id) on delete set null,
  approved_at        timestamptz,
  paid_on            date,
  payment_id         uuid references payments(id) on delete set null,
  pdf_path           text,
  notes              text,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (period_end >= period_start),
  unique (owner_id, period_start, period_end)
);
create index owner_statements_owner_idx on owner_statements(owner_id, period_start desc);
create trigger owner_statements_touch before update on owner_statements
  for each row execute function pms.touch_updated_at();

create table owner_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  statement_id    uuid not null references owner_statements(id) on delete cascade,
  ledger_entry_id uuid references ledger_entries(id) on delete set null,
  unit_id         uuid references units(id) on delete set null,
  unit_label      text,                        -- snapshot
  entry_date      date not null,
  category_code   text,
  description     text not null,
  direction       ledger_direction not null,
  amount_aed      numeric(14,2) not null,
  vat_amount_aed  numeric(14,2) not null default 0,
  total_aed       numeric(14,2) not null,
  sort_order      integer not null default 0
);
create index owner_statement_lines_stmt_idx on owner_statement_lines(statement_id, sort_order);

alter table ledger_entries
  add constraint ledger_statement_fk
  foreign key (statement_id) references owner_statements(id) on delete set null;
