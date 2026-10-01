-- ============================================================================
-- D|R|P PMS - 0023 Holiday-home stays post their income to the ledger
--
-- Until now only cleared rent cheques reached the ledger, so the Ledger page,
-- owner statements and the finance figures had no holiday-home income at all.
--
-- post_completed_bookings() brings the ledger in line with the bookings:
--
--   * a stay that has ended (check-out today or earlier), is not cancelled
--     and has a payout gets one income line under INC-BOOKING, dated its
--     check-out day, for the payout (Airbnb's "Amount": what D|R|P receives,
--     after the channel's fee and the Tourism Dirham). No VAT line.
--   * if the payout changes later (a price entered by hand, then the earnings
--     CSV), the line follows it - until the line is in an owner statement,
--     which never changes after it is issued.
--   * a stay cancelled or unpriced after posting loses its line, on the same
--     condition.
--
-- Status is not used to decide "ended": an Airbnb stay stays "confirmed"
-- unless someone checks the guest out, but it has ended all the same. So the
-- function runs on a schedule rather than from a trigger - the app calls it
-- when the ledger or a statement is opened, and the calendar cron calls it
-- too. Running it twice changes nothing.
-- ============================================================================

create or replace function post_completed_bookings()
returns integer
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_cat   uuid := (select id from gl_categories where code = 'INC-BOOKING');
  v_posted integer;
begin
  -- Staff, or the service role (cron). Owners and tenants never post.
  if auth.uid() is not null and not pms.is_staff() then
    return 0;
  end if;

  -- Lines whose stay was deleted, not yet in a statement.
  delete from ledger_entries le
   where le.source_table = 'bookings'
     and le.statement_id is null
     and not exists (select 1 from bookings b where b.id = le.source_id);

  -- Lines whose stay no longer qualifies, not yet in a statement.
  delete from ledger_entries le
   using bookings b
   where le.source_table = 'bookings'
     and le.source_id = b.id
     and le.statement_id is null
     and (b.status not in ('confirmed','checked_in','checked_out')
          or b.check_out > v_today
          or coalesce(b.payout_expected_aed, 0) <= 0);

  -- Lines whose stay's payout or dates moved, not yet in a statement.
  update ledger_entries le
     set amount_aed = b.payout_expected_aed,
         entry_date = b.check_out,
         unit_id    = b.unit_id
    from bookings b
   where le.source_table = 'bookings'
     and le.source_id = b.id
     and le.statement_id is null
     and (le.amount_aed <> b.payout_expected_aed
          or le.entry_date <> b.check_out
          or le.unit_id is distinct from b.unit_id);

  -- New lines for ended, priced stays.
  insert into ledger_entries (
    entry_date, unit_id, owner_id, category_id, direction, description,
    amount_aed, vat_applicable, source_table, source_id, booking_id
  )
  select b.check_out,
         b.unit_id,
         (select uo.owner_id from unit_ownerships uo
           where uo.unit_id = b.unit_id and uo.end_date is null
           order by uo.is_primary_contact desc, uo.ownership_pct desc
           limit 1),
         v_cat,
         'income',
         'Stay ' || b.booking_number
           || coalesce(' (' || initcap(b.channel::text) || ' ' || b.external_booking_id || ')', '')
           || ', ' || to_char(b.check_in, 'DD Mon') || ' - ' || to_char(b.check_out, 'DD Mon YYYY'),
         b.payout_expected_aed,
         false,
         'bookings',
         b.id,
         b.id
    from bookings b
   where b.status in ('confirmed','checked_in','checked_out')
     and b.check_out <= v_today
     and coalesce(b.payout_expected_aed, 0) > 0
     and not exists (select 1 from ledger_entries le
                      where le.source_table = 'bookings' and le.source_id = b.id);
  get diagnostics v_posted = row_count;

  return v_posted;
end;
$$;

comment on function post_completed_bookings() is
  'Posts the payout of every ended, priced stay to the ledger (INC-BOOKING) and keeps unissued lines in step. Idempotent.';

revoke all on function post_completed_bookings() from public, anon;
grant execute on function post_completed_bookings() to authenticated, service_role;

create unique index if not exists ledger_entries_booking_source_idx
  on ledger_entries (source_id)
  where source_table = 'bookings';
