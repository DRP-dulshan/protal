-- ============================================================================
-- D|R|P PMS - 0021 Past Airbnb stays from the earnings export
--
-- The Airbnb calendar feed only carries current and future stays. Stays that
-- ended before a unit was linked come in from Airbnb's earnings CSV instead,
-- matched to a unit by the listing's name in that file.
--
--   units.airbnb_listing_name  The listing's title as Airbnb's earnings CSV
--                              shows it. Set the first time a file names it.
--
-- A stay recorded after it ended is inserted as checked_out. It needs no
-- turnover clean, so schedule_turnover() now skips that case; every other
-- path is unchanged.
-- ============================================================================

alter table units add column if not exists airbnb_listing_name text;

comment on column units.airbnb_listing_name is
  'The Airbnb listing title as the earnings CSV shows it; matches past stays to this unit.';

create index if not exists units_airbnb_listing_name_idx
  on units (lower(airbnb_listing_name))
  where airbnb_listing_name is not null;

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

  -- History: a stay entered after it ended was cleaned long ago.
  if tg_op = 'INSERT' and new.status = 'checked_out' then
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
