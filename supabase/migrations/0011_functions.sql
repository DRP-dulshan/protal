-- ============================================================================
-- D|R|P PMS - 0011 Business logic: sequences, cheque schedules, statements,
-- storage buckets and their access policies.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Human-readable reference numbers, per entity, per year.
-- ---------------------------------------------------------------------------
create sequence if not exists pms.lease_seq;
create sequence if not exists pms.booking_seq;
create sequence if not exists pms.ticket_seq;
create sequence if not exists pms.statement_seq;
create sequence if not exists pms.payment_seq;
create sequence if not exists pms.order_seq;
create sequence if not exists pms.agreement_seq;

create or replace function pms.next_reference(p_kind text)
returns text
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  prefix text;
  n      bigint;
  yr     text := to_char(now(), 'YYYY');
begin
  select case p_kind
    when 'lease'     then lease_prefix
    when 'booking'   then booking_prefix
    when 'ticket'    then ticket_prefix
    when 'statement' then statement_prefix
    else 'DRP'
  end into prefix
  from company_settings where id;

  n := case p_kind
    when 'lease'     then nextval('pms.lease_seq')
    when 'booking'   then nextval('pms.booking_seq')
    when 'ticket'    then nextval('pms.ticket_seq')
    when 'statement' then nextval('pms.statement_seq')
    when 'payment'   then nextval('pms.payment_seq')
    when 'order'     then nextval('pms.order_seq')
    when 'agreement' then nextval('pms.agreement_seq')
    else nextval('pms.lease_seq')
  end;

  if p_kind in ('payment','order','agreement') then
    prefix := 'DRP-' || upper(left(p_kind, 3));
  end if;

  return prefix || '-' || yr || '-' || lpad(n::text, 4, '0');
end;
$$;

-- Auto-number on insert when the caller leaves the field blank.
create or replace function pms.autonumber()
returns trigger
language plpgsql
as $$
begin
  -- The field checks must be nested rather than ANDed into the branch
  -- condition: plpgsql resolves new.<field> when it plans the expression, so a
  -- flat `tg_argv[0] = 'lease' and new.lease_number is null` would fail on
  -- every other table that lacks that column.
  if tg_argv[0] = 'lease' then
    if new.lease_number is null or new.lease_number = '' then
      new.lease_number := pms.next_reference('lease');
    end if;
  elsif tg_argv[0] = 'booking' then
    if new.booking_number is null or new.booking_number = '' then
      new.booking_number := pms.next_reference('booking');
    end if;
  elsif tg_argv[0] = 'ticket' then
    if new.ticket_number is null or new.ticket_number = '' then
      new.ticket_number := pms.next_reference('ticket');
    end if;
  elsif tg_argv[0] = 'statement' then
    if new.statement_number is null or new.statement_number = '' then
      new.statement_number := pms.next_reference('statement');
    end if;
  elsif tg_argv[0] = 'payment' then
    if new.payment_reference is null or new.payment_reference = '' then
      new.payment_reference := pms.next_reference('payment');
    end if;
  elsif tg_argv[0] = 'order' then
    if new.order_number is null or new.order_number = '' then
      new.order_number := pms.next_reference('order');
    end if;
  elsif tg_argv[0] = 'agreement' then
    if new.agreement_number is null or new.agreement_number = '' then
      new.agreement_number := pms.next_reference('agreement');
    end if;
  end if;
  return new;
end;
$$;

create trigger leases_autonumber before insert on leases
  for each row execute function pms.autonumber('lease');
create trigger bookings_autonumber before insert on bookings
  for each row execute function pms.autonumber('booking');
create trigger maintenance_autonumber before insert on maintenance_requests
  for each row execute function pms.autonumber('ticket');
create trigger owner_statements_autonumber before insert on owner_statements
  for each row execute function pms.autonumber('statement');
create trigger payments_autonumber before insert on payments
  for each row execute function pms.autonumber('payment');
create trigger service_orders_autonumber before insert on service_orders
  for each row execute function pms.autonumber('order');
create trigger mgmt_agreements_autonumber before insert on management_agreements
  for each row execute function pms.autonumber('agreement');

-- ---------------------------------------------------------------------------
-- Cheque / installment schedule generation.
-- Dubai convention: rent is split into 1, 2, 4, 6 or 12 cheques dated evenly
-- across the term, the first one on the lease start date.
-- ---------------------------------------------------------------------------
create or replace function generate_lease_installments(p_lease_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  l              leases%rowtype;
  months_per     numeric;
  per_amount     numeric(12,2);
  remainder      numeric(12,2);
  total          numeric(12,2);
  i              integer;
  due            date;
  created_count  integer := 0;
begin
  select * into l from leases where id = p_lease_id;
  if not found then
    raise exception 'Lease % not found', p_lease_id;
  end if;

  -- Never silently overwrite money that has already moved.
  if exists (
    select 1 from lease_installments
    where lease_id = p_lease_id and status not in ('scheduled','cancelled')
  ) then
    raise exception 'Lease % already has presented or cleared installments', l.lease_number;
  end if;

  delete from lease_installments where lease_id = p_lease_id and status = 'scheduled';

  total := coalesce(l.contract_value_aed, l.annual_rent_aed);
  months_per := 12.0 / l.installment_count;
  per_amount := round(total / l.installment_count, 2);
  -- Rounding difference goes on the first installment, not lost.
  remainder := total - (per_amount * l.installment_count);

  for i in 1..l.installment_count loop
    due := (l.start_date + ((i - 1) * months_per * interval '1 month'))::date;

    insert into lease_installments (
      lease_id, installment_no, due_date, amount_aed, method, cheque_date, status
    ) values (
      p_lease_id,
      i,
      due,
      per_amount + case when i = 1 then remainder else 0 end,
      l.payment_method,
      case when l.payment_method = 'cheque' then due else null end,
      'scheduled'
    );
    created_count := created_count + 1;
  end loop;

  return created_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Post rent to the ledger when an installment clears. This is what makes the
-- owner statement reflect COLLECTED income rather than invoiced income.
-- ---------------------------------------------------------------------------
create or replace function pms.post_cleared_installment()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_unit   uuid;
  v_owner  uuid;
  v_cat    uuid;
  v_lease  text;
begin
  if new.status <> 'cleared' or coalesce(old.status, 'scheduled') = 'cleared' then
    return new;
  end if;

  select l.unit_id, l.lease_number into v_unit, v_lease
  from leases l where l.id = new.lease_id;

  select uo.owner_id into v_owner
  from unit_ownerships uo
  where uo.unit_id = v_unit and uo.end_date is null
  order by uo.is_primary_contact desc, uo.ownership_pct desc
  limit 1;

  select id into v_cat from gl_categories where code = 'INC-RENT';

  -- Residential long-term rent is VAT-exempt in the UAE, hence false here.
  insert into ledger_entries (
    entry_date, unit_id, owner_id, category_id, direction, description,
    amount_aed, vat_applicable, source_table, source_id, lease_id
  ) values (
    coalesce(new.cleared_on, current_date),
    v_unit, v_owner, v_cat, 'income',
    'Rent installment ' || new.installment_no || ' - ' || v_lease,
    new.amount_aed, false, 'lease_installments', new.id, new.lease_id
  );

  return new;
end;
$$;

create trigger lease_installments_post_ledger
  after update of status on lease_installments
  for each row execute function pms.post_cleared_installment();

-- ---------------------------------------------------------------------------
-- Owner statement generation.
--   gross income   = collected income on the owner's units in the period
--   expenses       = owner-bearing costs in the period
--   management fee = per the active management agreement (% or flat), + VAT
--   net payout     = income - expenses - fee - VAT on the fee
-- Every line is snapshotted so a re-issue can never rewrite history.
-- ---------------------------------------------------------------------------
create or replace function generate_owner_statement(
  p_owner_id uuid,
  p_period_start date,
  p_period_end date
)
returns uuid
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_statement_id uuid;
  v_income   numeric(14,2) := 0;
  v_expense  numeric(14,2) := 0;
  v_fee      numeric(14,2) := 0;
  v_fee_vat  numeric(14,2) := 0;
  v_vat_rate numeric(5,4);
  v_sort     integer := 0;
  r          record;
begin
  select vat_rate into v_vat_rate from company_settings where id;

  if exists (
    select 1 from owner_statements
    where owner_id = p_owner_id
      and period_start = p_period_start
      and period_end = p_period_end
      and status <> 'void'
  ) then
    raise exception 'A statement already exists for this owner and period';
  end if;

  insert into owner_statements (owner_id, period_start, period_end, status, created_by)
  values (p_owner_id, p_period_start, p_period_end, 'draft', auth.uid())
  returning id into v_statement_id;

  -- Snapshot every ledger entry on this owner's units for the period that has
  -- not already been carried on another statement.
  for r in
    select le.*, gc.code as category_code, gc.affects_owner_statement,
           u.unit_number, p.name as property_name
    from ledger_entries le
    join gl_categories gc on gc.id = le.category_id
    left join units u on u.id = le.unit_id
    left join properties p on p.id = u.property_id
    where le.owner_id = p_owner_id
      and le.entry_date between p_period_start and p_period_end
      and le.statement_id is null
      and le.is_owner_visible
      and gc.affects_owner_statement
      and gc.code <> 'EXP-MGMT-FEE'      -- the fee is computed below, not copied
    order by le.entry_date, le.created_at
  loop
    v_sort := v_sort + 1;

    insert into owner_statement_lines (
      statement_id, ledger_entry_id, unit_id, unit_label, entry_date,
      category_code, description, direction, amount_aed, vat_amount_aed,
      total_aed, sort_order
    ) values (
      v_statement_id, r.id, r.unit_id,
      coalesce(r.property_name || ' - ' || r.unit_number, 'Portfolio'),
      r.entry_date, r.category_code, r.description, r.direction,
      r.amount_aed, r.vat_amount_aed, r.total_aed, v_sort
    );

    update ledger_entries set statement_id = v_statement_id where id = r.id;

    if r.direction = 'income' then
      v_income := v_income + r.amount_aed;
    else
      v_expense := v_expense + r.total_aed;
    end if;
  end loop;

  -- Management fee, per unit, from the agreement in force during the period.
  for r in
    select ma.unit_id, ma.commission_pct, ma.fixed_fee_aed, ma.fee_vat_applicable,
           u.unit_number, p.name as property_name,
           coalesce(sum(le.amount_aed) filter (where le.direction = 'income'), 0) as unit_income
    from management_agreements ma
    join units u on u.id = ma.unit_id
    join properties p on p.id = u.property_id
    left join ledger_entries le
      on le.unit_id = ma.unit_id
     and le.statement_id = v_statement_id
     and le.direction = 'income'
    where ma.owner_id = p_owner_id
      and ma.is_active
      and ma.start_date <= p_period_end
      and ma.end_date >= p_period_start
    group by ma.unit_id, ma.commission_pct, ma.fixed_fee_aed, ma.fee_vat_applicable,
             u.unit_number, p.name
  loop
    declare
      line_fee numeric(14,2);
      line_vat numeric(14,2);
    begin
      if r.commission_pct is not null then
        line_fee := round(r.unit_income * r.commission_pct / 100.0, 2);
      else
        line_fee := coalesce(r.fixed_fee_aed, 0);
      end if;

      if line_fee <= 0 then
        continue;
      end if;

      -- Management fee is a taxable supply of services: VAT normally applies.
      line_vat := case when r.fee_vat_applicable then round(line_fee * v_vat_rate, 2) else 0 end;

      v_fee     := v_fee + line_fee;
      v_fee_vat := v_fee_vat + line_vat;
      v_sort    := v_sort + 1;

      insert into owner_statement_lines (
        statement_id, unit_id, unit_label, entry_date, category_code,
        description, direction, amount_aed, vat_amount_aed, total_aed, sort_order
      ) values (
        v_statement_id, r.unit_id, r.property_name || ' - ' || r.unit_number,
        p_period_end, 'EXP-MGMT-FEE',
        case when r.commission_pct is not null
          then 'Management fee (' || r.commission_pct || '% of AED ' || r.unit_income || ')'
          else 'Management fee (fixed)' end,
        'expense', line_fee, line_vat, line_fee + line_vat, v_sort
      );
    end;
  end loop;

  update owner_statements
     set gross_income_aed   = v_income,
         total_expenses_aed = v_expense,
         management_fee_aed = v_fee,
         vat_total_aed      = v_fee_vat,
         net_payout_aed     = v_income - v_expense - v_fee - v_fee_vat,
         closing_balance_aed = v_income - v_expense - v_fee - v_fee_vat
   where id = v_statement_id;

  return v_statement_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Keep unit.status in step with reality instead of relying on staff to
-- remember. Lease activation/termination and bookings drive it.
-- ---------------------------------------------------------------------------
create or replace function pms.sync_unit_status()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if new.status = 'active' then
    update units set status = 'occupied_long_term' where id = new.unit_id;
  elsif new.status in ('terminated','expired','cancelled')
        and not exists (
          select 1 from leases
          where unit_id = new.unit_id and status in ('active','expiring') and id <> new.id
        ) then
    update units
       set status = case
             when operating_mode in ('short_term','both')
                  and pms.unit_has_valid_permit(new.unit_id) then 'listed_short_term'
             else 'vacant'
           end
     where id = new.unit_id;
  end if;
  return new;
end;
$$;

create trigger leases_sync_unit_status
  after insert or update of status on leases
  for each row execute function pms.sync_unit_status();

-- ---------------------------------------------------------------------------
-- Turnover housekeeping: when a booking is confirmed, schedule the clean into
-- the checkout -> next check-in gap automatically.
-- ---------------------------------------------------------------------------
create or replace function pms.schedule_turnover()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_next uuid;
begin
  if new.status not in ('confirmed','checked_out') then
    return new;
  end if;

  if exists (select 1 from housekeeping_tasks
             where booking_id = new.id and kind = 'turnover' and status <> 'cancelled') then
    return new;
  end if;

  select id into v_next
  from bookings
  where unit_id = new.unit_id
    and check_in >= new.check_out
    and status in ('tentative','confirmed','checked_in')
    and id <> new.id
  order by check_in
  limit 1;

  insert into housekeeping_tasks (
    unit_id, booking_id, next_booking_id, kind, status, scheduled_start, scheduled_end
  ) values (
    new.unit_id, new.id, v_next, 'turnover', 'pending',
    (new.check_out + time '11:00') at time zone 'Asia/Dubai',
    (new.check_out + time '15:00') at time zone 'Asia/Dubai'
  );

  return new;
end;
$$;

create trigger bookings_schedule_turnover
  after insert or update of status on bookings
  for each row execute function pms.schedule_turnover();

-- Mirror confirmed bookings into the availability calendar so the channel
-- manager has a single surface to read from.
create or replace function pms.sync_booking_block()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  delete from availability_blocks where booking_id = new.id;

  if new.status in ('tentative','confirmed','checked_in') then
    insert into availability_blocks (unit_id, start_date, end_date, reason, booking_id, source_channel)
    values (new.unit_id, new.check_in, new.check_out, 'booking', new.id, new.channel);
  end if;

  return new;
end;
$$;

create trigger bookings_sync_block
  after insert or update of status, check_in, check_out on bookings
  for each row execute function pms.sync_booking_block();

-- ---------------------------------------------------------------------------
-- Storage buckets. Private by default; access is mediated by signed URLs
-- issued server-side after the same unit check the tables use.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 26214400,
   array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('media', 'media', false, 15728640,
   array['image/jpeg','image/png','image/webp','image/avif','video/mp4'])
on conflict (id) do nothing;

-- Object paths are namespaced as <entity>/<entity_id>/<filename>, so the unit
-- check can be derived from the path itself.
create policy "documents read for permitted staff and parties"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'documents'
    and (
      pms.is_staff()
      or exists (
        select 1 from documents d
        where d.bucket = 'documents'
          and d.storage_path = storage.objects.name
          and (
            (d.unit_id is not null and pms.can_read_unit(d.unit_id))
            or (d.owner_id is not null and d.owner_id in (select pms.my_owner_ids()))
            or d.uploaded_by = auth.uid()
          )
      )
    )
  );

create policy "documents upload for signed-in users"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'documents');

create policy "documents delete for admins"
  on storage.objects for delete to authenticated
  using (bucket_id = 'documents' and pms.is_admin());

create policy "media read for signed-in users"
  on storage.objects for select to authenticated
  using (bucket_id = 'media');

create policy "media write for staff"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'media' and pms.is_staff());

create policy "media delete for staff"
  on storage.objects for delete to authenticated
  using (bucket_id = 'media' and pms.is_staff());
