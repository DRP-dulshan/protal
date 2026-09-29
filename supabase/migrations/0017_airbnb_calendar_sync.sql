-- ============================================================================
-- D|R|P PMS - 0017 Airbnb calendar sync (iCal import and export)
--
-- No channel manager: Airbnb publishes each listing's calendar as an iCal
-- feed, and imports ours.
--
-- Import  - every 15 minutes the app fetches each unit's Airbnb feed and hands
--           the parsed events to apply_airbnb_ical(), which reconciles them in
--           one transaction: new reservations are created, moved ones updated,
--           vanished future ones cancelled, and "Not available" periods kept
--           as channel_sync blocks.
-- Export  - each unit has a secret feed token. /api/ical/<token>.ics lists
--           the unit's confirmed non-Airbnb bookings and manual blocks, so
--           Airbnb closes those dates. Airbnb's own bookings are never
--           exported back to it: that would loop.
-- ============================================================================

-- A 64-character hex secret. Built from two v4 UUIDs (122 random bits each,
-- from the server's strong RNG) so it needs no extension-schema function.
create or replace function pms.new_feed_token()
returns text
language sql
volatile
as $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
$$;

-- ---------------------------------------------------------------------------
-- Units: the Airbnb feed to read, our feed's secret, and the last sync result.
-- ---------------------------------------------------------------------------
alter table units
  add column if not exists airbnb_ical_url       text,
  add column if not exists ical_export_token     text,
  add column if not exists ical_last_synced_at   timestamptz,
  add column if not exists ical_last_status      text,
  add column if not exists ical_last_error       text,
  add column if not exists ical_last_event_count integer;

update units set ical_export_token = pms.new_feed_token() where ical_export_token is null;
alter table units alter column ical_export_token set default pms.new_feed_token();
alter table units alter column ical_export_token set not null;
create unique index if not exists units_ical_export_token_idx on units(ical_export_token);

alter table units drop constraint if exists units_airbnb_ical_url_https;
alter table units add constraint units_airbnb_ical_url_https
  check (airbnb_ical_url is null or airbnb_ical_url ~ '^https://');
alter table units drop constraint if exists units_ical_last_status_check;
alter table units add constraint units_ical_last_status_check
  check (ical_last_status is null or ical_last_status in ('ok', 'error'));

comment on column units.airbnb_ical_url is
  'Airbnb listing calendar export (Airbnb: Calendar > Availability > Connect calendars > Export).';
comment on column units.ical_export_token is
  'Secret for /api/ical/<token>.ics. Anyone with the URL can see which dates are blocked (never who, never prices). Regenerate if leaked.';

-- ---------------------------------------------------------------------------
-- Bookings and blocks remember which feed event they came from.
-- ---------------------------------------------------------------------------
alter table bookings
  add column if not exists ical_uid                text,
  add column if not exists imported_without_permit boolean not null default false,
  add column if not exists last_seen_in_feed_at    timestamptz;

create unique index if not exists bookings_unit_ical_uid_idx
  on bookings(unit_id, ical_uid) where ical_uid is not null;

comment on column bookings.ical_uid is 'UID of the Airbnb calendar event this booking was imported from.';
comment on column bookings.imported_without_permit is
  'Imported from Airbnb while the unit had no valid DET permit for the check-in date. Needs attention.';

alter table availability_blocks
  add column if not exists ical_uid text;

create unique index if not exists availability_blocks_unit_ical_uid_idx
  on availability_blocks(unit_id, ical_uid) where ical_uid is not null;

-- ---------------------------------------------------------------------------
-- DET permit gate: an Airbnb reservation already exists whether or not we
-- record it, and not recording it would leave the dates open to a double
-- booking. So imports on a unit without a valid permit are accepted and
-- flagged instead of rejected. Everything else keeps the hard gate.
-- ---------------------------------------------------------------------------
create or replace function pms.enforce_permit_before_booking()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('tentative','confirmed','checked_in') then
    if not pms.unit_has_valid_permit(new.unit_id, new.check_in) then
      if new.ical_uid is not null and new.channel = 'airbnb' then
        new.imported_without_permit := true;
        return new;
      end if;
      raise exception
        'Booking for unit % rejected: no valid DET holiday home permit covering check-in date %',
        new.unit_id, new.check_in
        using errcode = 'check_violation';
    end if;
    new.imported_without_permit := false;
    if new.permit_number_at_booking is null then
      new.permit_number_at_booking := pms.unit_permit_number(new.unit_id);
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_airbnb_ical: reconcile one unit's feed.
--
-- p_events is a JSON array of {uid, start, end, kind, code}: kind is
-- 'reservation' or 'blocked', dates are ISO, end is exclusive (the check-out
-- day), code is the Airbnb confirmation code when the feed carries one.
-- Pass p_error instead when the feed could not be fetched or parsed.
--
-- SECURITY INVOKER: RLS applies. Staff who may write the unit can run it
-- ("Sync now"); the scheduler runs it with the service key. Anyone else is
-- stopped at the first read of the unit.
--
-- Each event is applied in its own savepoint, so one clash (an Airbnb stay
-- overlapping a direct booking) is reported without blocking the rest.
-- ---------------------------------------------------------------------------
create or replace function apply_airbnb_ical(
  p_unit_id uuid,
  p_events  jsonb,
  p_error   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pms
as $$
declare
  c_removed  constant text := 'Removed from the Airbnb calendar feed';
  v_today    date := (now() at time zone 'Asia/Dubai')::date;
  v_now      timestamptz := now();
  v_events   jsonb := coalesce(p_events, '[]'::jsonb);
  e          jsonb;
  v_uid      text;
  v_start    date;
  v_end      date;
  v_code     text;
  v_kind     text;
  v_id       uuid;
  v_row      bookings%rowtype;
  v_uids     text[];
  v_live     integer;
  v_errors   text[] := '{}';
  v_created  integer := 0;
  v_updated  integer := 0;
  v_reinstated integer := 0;
  v_cancelled  integer := 0;
  v_blocks   integer := 0;
begin
  if not exists (select 1 from units where id = p_unit_id) then
    raise exception 'Unit % not found', p_unit_id using errcode = 'no_data_found';
  end if;

  if p_error is not null then
    update units
       set ical_last_synced_at = v_now, ical_last_status = 'error', ical_last_error = left(p_error, 500)
     where id = p_unit_id;
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array(p_error));
  end if;

  if jsonb_typeof(v_events) <> 'array' then
    raise exception 'p_events must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  select coalesce(array_agg(x->>'uid') filter (where x->>'uid' is not null), '{}')
    into v_uids
    from jsonb_array_elements(v_events) x;

  for e in select * from jsonb_array_elements(v_events) loop
    v_uid  := nullif(e->>'uid', '');
    v_code := nullif(e->>'code', '');
    v_kind := coalesce(e->>'kind', 'reservation');
    begin
      v_start := (e->>'start')::date;
      v_end   := (e->>'end')::date;
    exception when others then
      v_start := null;
    end;

    if v_uid is null or v_start is null or v_end is null or v_end <= v_start then
      v_errors := v_errors || format('Skipped an event with missing or invalid dates (%s).', coalesce(v_uid, 'no UID'));
      continue;
    end if;

    begin
      if v_kind = 'blocked' then
        insert into availability_blocks (unit_id, start_date, end_date, reason, source_channel, ical_uid, note)
        values (p_unit_id, v_start, v_end, 'channel_sync', 'airbnb', v_uid, 'Not available on Airbnb')
        on conflict (unit_id, ical_uid) where ical_uid is not null
        do update set start_date = excluded.start_date, end_date = excluded.end_date;
        v_blocks := v_blocks + 1;
        continue;
      end if;

      select * into v_row from bookings where unit_id = p_unit_id and ical_uid = v_uid;

      if not found then
        -- A booking staff typed in by hand before the sync existed: adopt it
        -- rather than create a duplicate that would clash with it.
        select * into v_row
          from bookings
         where unit_id = p_unit_id
           and channel = 'airbnb'
           and ical_uid is null
           and status in ('tentative','confirmed','checked_in')
           and ((v_code is not null and external_booking_id = v_code)
                or (check_in = v_start and check_out = v_end))
         order by coalesce(v_code is not null and external_booking_id = v_code, false) desc
         limit 1;

        if found then
          update bookings
             set ical_uid = v_uid,
                 external_booking_id = coalesce(external_booking_id, v_code),
                 check_in = v_start,
                 check_out = v_end,
                 last_seen_in_feed_at = v_now
           where id = v_row.id;
          v_updated := v_updated + 1;
        else
          insert into bookings (unit_id, channel, status, check_in, check_out, adults,
                                guest_count_known, ical_uid, external_booking_id,
                                last_seen_in_feed_at, internal_notes)
          values (p_unit_id, 'airbnb', 'confirmed', v_start, v_end, 1,
                  false, v_uid, v_code, v_now, 'Imported from the Airbnb calendar feed.');
          v_created := v_created + 1;
        end if;
      else
        if v_row.status = 'cancelled' and v_row.cancellation_reason = c_removed then
          -- It came back (Airbnb restored or re-listed it).
          update bookings
             set status = 'confirmed', cancelled_on = null, cancellation_reason = null,
                 check_in = v_start, check_out = v_end, last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
          v_reinstated := v_reinstated + 1;
        elsif v_row.check_in <> v_start or v_row.check_out <> v_end then
          update bookings
             set check_in = v_start, check_out = v_end, last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
          v_updated := v_updated + 1;
        else
          update bookings
             set last_seen_in_feed_at = v_now,
                 external_booking_id = coalesce(external_booking_id, v_code)
           where id = v_row.id;
        end if;
      end if;
    exception
      when exclusion_violation then
        v_errors := v_errors || format(
          'Airbnb stay %s to %s overlaps another booking on this unit and was not imported.',
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'));
      when check_violation or unique_violation then
        v_errors := v_errors || format('Airbnb stay %s to %s: %s',
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'), sqlerrm);
    end;
  end loop;

  -- Cancellations: a synced future stay missing from the feed was cancelled
  -- on Airbnb. Past stays are left alone - Airbnb drops old events from the
  -- feed, which is not a cancellation. Checked-in guests are left alone too.
  select count(*) into v_live
    from bookings
   where unit_id = p_unit_id and ical_uid is not null
     and status in ('tentative','confirmed') and check_out > v_today;

  if jsonb_array_length(v_events) = 0 and v_live >= 2 then
    -- An empty feed with several live stays is far more likely a broken or
    -- replaced link than every guest cancelling at once.
    v_errors := v_errors || format(
      'The Airbnb feed came back empty while %s upcoming stays are synced. Nothing was cancelled - check the calendar link.',
      v_live);
  else
    with gone as (
      update bookings
         set status = 'cancelled', cancelled_on = v_today, cancellation_reason = c_removed
       where unit_id = p_unit_id
         and channel = 'airbnb'
         and ical_uid is not null
         and not (ical_uid = any (v_uids))
         and status in ('tentative','confirmed')
         and check_out > v_today
      returning 1
    )
    select count(*) into v_cancelled from gone;

    delete from availability_blocks
     where unit_id = p_unit_id
       and reason = 'channel_sync'
       and ical_uid is not null
       and not (ical_uid = any (v_uids));
  end if;

  update units
     set ical_last_synced_at   = v_now,
         ical_last_status      = case when cardinality(v_errors) = 0 then 'ok' else 'error' end,
         ical_last_error       = nullif(array_to_string(v_errors[1:5], ' '), ''),
         ical_last_event_count = jsonb_array_length(v_events)
   where id = p_unit_id;

  return jsonb_build_object(
    'ok',         cardinality(v_errors) = 0,
    'created',    v_created,
    'updated',    v_updated,
    'reinstated', v_reinstated,
    'cancelled',  v_cancelled,
    'blocks',     v_blocks,
    'errors',     to_jsonb(v_errors)
  );
end;
$$;

revoke all on function apply_airbnb_ical(uuid, jsonb, text) from public, anon;
grant execute on function apply_airbnb_ical(uuid, jsonb, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- ical_export_events: what our feed tells Airbnb. Dates and a neutral label
-- only - no guest names, no prices. Called server-side with the service key
-- after the route has matched the token; not reachable by portal users.
-- ---------------------------------------------------------------------------
create or replace function ical_export_events(p_token text)
returns table (uid text, start_date date, end_date date, kind text)
language sql
stable
security invoker
set search_path = public, pms
as $$
  with u as (
    select id from units where ical_export_token = p_token and is_active
  ), horizon as (
    select (now() at time zone 'Asia/Dubai')::date - 1 as from_day
  )
  select 'booking-' || b.id::text, b.check_in, b.check_out, 'booking'
    from bookings b join u on u.id = b.unit_id, horizon h
   where b.channel <> 'airbnb'
     and b.status in ('confirmed','checked_in','checked_out')
     and b.check_out >= h.from_day
  union all
  select 'block-' || ab.id::text, ab.start_date, ab.end_date, ab.reason::text
    from availability_blocks ab join u on u.id = ab.unit_id, horizon h
   where ab.reason in ('maintenance','owner_stay','blocked','housekeeping')
     and ab.end_date >= h.from_day
  order by 2, 1;
$$;

revoke all on function ical_export_events(text) from public, anon, authenticated;
grant execute on function ical_export_events(text) to service_role;
