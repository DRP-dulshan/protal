-- ============================================================================
-- D|R|P PMS - 0025 Booking.com alongside Airbnb
--
-- Booking.com publishes each property's availability as an iCal feed too
-- (extranet: Rates & Availability > Sync calendars > Export). Its events carry
-- dates only - no reservation number, no guest - and the reservation details
-- come from the extranet's reservations export, imported like Airbnb's
-- earnings file.
--
--   units.booking_ical_url (+ its own last-sync columns)
--   units.booking_listing_name  the property's name in Booking.com's export
--
-- apply_channel_ical(unit, channel, events, error) is apply_airbnb_ical made
-- per channel: each channel's feed creates, moves and cancels only its own
-- stays and blocks, and keeps its own sync status. apply_airbnb_ical stays as
-- a wrapper, so existing callers are unchanged.
--
-- The first read of a newly linked feed is still not announced; that is now
-- marked on the booking (import_source = 'feed_first_read') rather than
-- inferred from the Airbnb sync time, so it works for each channel.
-- ============================================================================

alter table units
  add column if not exists booking_ical_url              text,
  add column if not exists booking_ical_last_synced_at   timestamptz,
  add column if not exists booking_ical_last_status      text,
  add column if not exists booking_ical_last_error       text,
  add column if not exists booking_ical_last_event_count integer,
  add column if not exists booking_listing_name          text;

alter table units drop constraint if exists units_booking_ical_url_https;
alter table units add constraint units_booking_ical_url_https
  check (booking_ical_url is null or booking_ical_url ~ '^https://');
alter table units drop constraint if exists units_booking_ical_last_status_check;
alter table units add constraint units_booking_ical_last_status_check
  check (booking_ical_last_status is null or booking_ical_last_status in ('ok', 'error'));

comment on column units.booking_ical_url is
  'Booking.com calendar export (extranet: Rates & Availability > Sync calendars > Export).';
comment on column units.booking_listing_name is
  'The property name as Booking.com''s reservations export shows it; matches its reservations to this unit.';

create index if not exists units_booking_listing_name_idx
  on units (lower(booking_listing_name))
  where booking_listing_name is not null;

alter table bookings drop constraint if exists bookings_import_source_check;
alter table bookings add constraint bookings_import_source_check
  check (import_source is null or import_source in ('earnings_csv', 'feed_first_read'));

-- ---------------------------------------------------------------------------
-- Per-channel feed reconciliation
-- ---------------------------------------------------------------------------
create or replace function apply_channel_ical(
  p_unit_id uuid,
  p_channel sales_channel,
  p_events  jsonb,
  p_error   text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pms
as $$
declare
  v_name     text := case p_channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' end;
  c_removed  text := 'Removed from the ' || case p_channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' end || ' calendar feed';
  v_first    boolean;
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
  if p_channel not in ('airbnb','booking_com') then
    raise exception 'No calendar feed for channel %', p_channel using errcode = 'invalid_parameter_value';
  end if;

  select case p_channel when 'airbnb' then ical_last_synced_at is null
                        else booking_ical_last_synced_at is null end
    into v_first
    from units where id = p_unit_id;
  if not found then
    raise exception 'Unit % not found', p_unit_id using errcode = 'no_data_found';
  end if;

  if p_error is not null then
    if p_channel = 'airbnb' then
      update units
         set ical_last_synced_at = v_now, ical_last_status = 'error', ical_last_error = left(p_error, 500)
       where id = p_unit_id;
    else
      update units
         set booking_ical_last_synced_at = v_now, booking_ical_last_status = 'error',
             booking_ical_last_error = left(p_error, 500)
       where id = p_unit_id;
    end if;
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
        values (p_unit_id, v_start, v_end, 'channel_sync', p_channel, v_uid, 'Not available on ' || v_name)
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
           and channel = p_channel
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
          -- The first read of a newly linked feed brings every existing
          -- reservation: recorded, not announced (0018 did this for Airbnb by
          -- its own sync time; each channel now has its own).
          insert into bookings (unit_id, channel, status, check_in, check_out, adults,
                                guest_count_known, ical_uid, external_booking_id,
                                last_seen_in_feed_at, internal_notes, import_source)
          values (p_unit_id, p_channel, 'confirmed', v_start, v_end, 1,
                  false, v_uid, v_code, v_now, 'Imported from the ' || v_name || ' calendar feed.',
                  case when v_first then 'feed_first_read' end);
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
          '%s stay %s to %s overlaps another booking on this unit and was not imported.', v_name,
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'));
      when check_violation or unique_violation then
        v_errors := v_errors || format('%s stay %s to %s: %s', v_name,
          to_char(v_start, 'DD Mon YYYY'), to_char(v_end, 'DD Mon YYYY'), sqlerrm);
    end;
  end loop;

  -- Cancellations: a synced future stay missing from the feed was cancelled
  -- on Airbnb. Past stays are left alone - Airbnb drops old events from the
  -- feed, which is not a cancellation. Checked-in guests are left alone too.
  select count(*) into v_live
    from bookings
   where unit_id = p_unit_id and channel = p_channel and ical_uid is not null
     and status in ('tentative','confirmed') and check_out > v_today;

  if jsonb_array_length(v_events) = 0 and v_live >= 2 then
    -- An empty feed with several live stays is far more likely a broken or
    -- replaced link than every guest cancelling at once.
    v_errors := v_errors || format(
      'The %s feed came back empty while %s upcoming stays are synced. Nothing was cancelled - check the calendar link.',
      v_name, v_live);
  else
    with gone as (
      update bookings
         set status = 'cancelled', cancelled_on = v_today, cancellation_reason = c_removed
       where unit_id = p_unit_id
         and channel = p_channel
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
       and source_channel = p_channel
       and ical_uid is not null
       and not (ical_uid = any (v_uids));
  end if;

  if p_channel = 'airbnb' then
    update units
       set ical_last_synced_at   = v_now,
           ical_last_status      = case when cardinality(v_errors) = 0 then 'ok' else 'error' end,
           ical_last_error       = nullif(array_to_string(v_errors[1:5], ' '), ''),
           ical_last_event_count = jsonb_array_length(v_events)
     where id = p_unit_id;
  else
    update units
       set booking_ical_last_synced_at   = v_now,
           booking_ical_last_status      = case when cardinality(v_errors) = 0 then 'ok' else 'error' end,
           booking_ical_last_error       = nullif(array_to_string(v_errors[1:5], ' '), ''),
           booking_ical_last_event_count = jsonb_array_length(v_events)
     where id = p_unit_id;
  end if;

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

revoke all on function apply_channel_ical(uuid, sales_channel, jsonb, text) from public, anon;
grant execute on function apply_channel_ical(uuid, sales_channel, jsonb, text) to authenticated, service_role;

create or replace function apply_airbnb_ical(
  p_unit_id uuid,
  p_events  jsonb,
  p_error   text default null
)
returns jsonb
language sql
security invoker
set search_path = public, pms
as $$
  select apply_channel_ical(p_unit_id, 'airbnb', p_events, p_error);
$$;

-- ---------------------------------------------------------------------------
-- Permit gate: Booking.com stays from its feed or export are recorded and
-- flagged like Airbnb's, not refused.
-- ---------------------------------------------------------------------------
create or replace function pms.enforce_permit_before_booking()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('tentative','confirmed','checked_in') then
    if not pms.unit_has_valid_permit(new.unit_id, new.check_in) then
      if new.channel in ('airbnb','booking_com')
         and (new.ical_uid is not null or new.import_source = 'earnings_csv') then
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
-- Ledger lines name the channel properly ("Booking.com", not "Booking_Com").
-- ---------------------------------------------------------------------------
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
           || coalesce(' (' || case b.channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' else initcap(replace(b.channel::text, '_', ' ')) end || ' ' || b.external_booking_id || ')', '')
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


-- ---------------------------------------------------------------------------
-- Notifications: the "first read of a new Airbnb link" rule (0018) looked at
-- the Airbnb sync time for any feed stay. Now Airbnb only.
-- ---------------------------------------------------------------------------
create or replace function pms.notify_booking_event()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  c_live   constant text[] := array['tentative', 'confirmed', 'checked_in'];
  v_kind   text;
  v_unit   record;
  v_office text;
  v_show_first_name boolean;
  v_first  text;
  v_label  text;
  v_dates  text;
  v_via    text;
  v_title  text;
  v_owner_body text;
  v_staff_body text;
  v_owner_link constant text := '/portal/owner/bookings';
  v_staff_link text := '/bookings/' || new.id;
begin
  if tg_op = 'INSERT' then
    if new.status::text = any (c_live) then
      v_kind := 'booking_new';
    end if;
  elsif new.status::text = any (c_live) and not (old.status::text = any (c_live))
        and old.status <> 'checked_out' then
    -- An enquiry confirmed, or an Airbnb stay back in the feed.
    v_kind := 'booking_new';
  elsif old.status::text = any (c_live) and new.status = 'cancelled' then
    v_kind := 'booking_cancelled';
  elsif new.status::text = any (c_live)
        and (new.check_in <> old.check_in or new.check_out <> old.check_out) then
    v_kind := 'booking_changed';
  end if;

  if v_kind is null then
    return new;
  end if;

  -- History is not news.
  if new.check_out < (now() at time zone 'Asia/Dubai')::date then
    return new;
  end if;

  select u.id, u.unit_number, u.property_id, u.ical_last_synced_at, p.name as property_name
    into v_unit
    from units u
    join properties p on p.id = u.property_id
   where u.id = new.unit_id;

  -- The first sync of a newly linked Airbnb calendar imports every existing
  -- reservation; they are not new bookings.
  -- (Airbnb only: every channel's first read is now marked on the booking,
  -- import_source = 'feed_first_read', and the insert trigger skips those.
  -- Checking Airbnb's sync time for a Booking.com stay would silence a unit
  -- that has no Airbnb link for good.)
  if new.ical_uid is not null and new.channel = 'airbnb' and v_unit.ical_last_synced_at is null then
    return new;
  end if;

  select email, show_guest_first_name_to_owners
    into v_office, v_show_first_name
    from company_settings
   where id;

  if v_show_first_name and new.guest_id is not null then
    select nullif(split_part(trim(full_name), ' ', 1), '') into v_first
      from guests where id = new.guest_id;
  end if;

  v_label := v_unit.property_name || ' ' || v_unit.unit_number;
  v_dates := to_char(new.check_in, 'DD Mon YYYY') || ' to ' || to_char(new.check_out, 'DD Mon YYYY')
             || ' (' || (new.check_out - new.check_in)
             || case when new.check_out - new.check_in = 1 then ' night)' else ' nights)' end;
  v_via := case new.channel
             when 'airbnb' then 'Airbnb'
             when 'booking_com' then 'Booking.com'
             when 'vrbo' then 'Vrbo'
             when 'direct' then 'a direct booking'
             else initcap(replace(new.channel::text, '_', ' '))
           end;

  v_title := case v_kind
               when 'booking_new' then 'New booking: '
               when 'booking_changed' then 'Booking dates changed: '
               else 'Booking cancelled: '
             end || v_label;

  -- Owners: no booking number, no money.
  v_owner_body := case v_kind
                    when 'booking_cancelled' then 'The stay of ' || v_dates || ' via ' || v_via
                                                  || ' was cancelled. These dates are open again.'
                    when 'booking_changed' then 'The stay via ' || v_via || ' is now ' || v_dates || '.'
                    else v_dates || ', via ' || v_via || '.'
                  end
                  || coalesce(' Guest: ' || v_first || '.', '');

  v_staff_body := new.booking_number || ' - ' || v_dates || ', via ' || v_via || '.'
                  || case when v_kind <> 'booking_cancelled' and new.gross_total_aed = 0
                          then ' Price not entered yet.' else '' end
                  || case when new.imported_without_permit
                          then ' No valid DET permit for these dates.' else '' end;

  -- Portal notifications: super admins, staff assigned to the unit or its
  -- property, and every login linked to an owner of the unit.
  insert into notifications (recipient_id, kind, title, body, link, booking_id, unit_id)
  select p.id, v_kind, v_title, v_staff_body, v_staff_link, new.id, new.unit_id
    from profiles p
   where p.is_active
     and (p.role = 'super_admin'
          or (p.role in ('property_manager', 'agent')
              and (exists (select 1 from staff_unit_assignments a
                            where a.profile_id = p.id and a.unit_id = new.unit_id)
                   or exists (select 1 from staff_property_assignments a
                               where a.profile_id = p.id and a.property_id = v_unit.property_id))));

  insert into notifications (recipient_id, kind, title, body, link, booking_id, unit_id)
  select distinct p.id, v_kind, v_title, v_owner_body, v_owner_link, new.id, new.unit_id
    from unit_ownerships uo
    join owner_users ou on ou.owner_id = uo.owner_id
    join profiles p on p.id = ou.profile_id
   where uo.unit_id = new.unit_id
     and uo.end_date is null
     and p.is_active
     and p.role = 'owner';

  -- Emails, sent by the app: the office address, and each owner with one.
  if v_office is not null and v_office <> '' then
    insert into messages (channel, status, party_kind, to_address, subject, body,
                          unit_id, booking_id, variables)
    values ('email', 'queued', 'staff', v_office, v_title, v_staff_body,
            new.unit_id, new.id, jsonb_build_object('portal', 'admin', 'link', v_staff_link));
  end if;

  insert into messages (channel, status, party_kind, party_id, to_address, subject, body,
                        unit_id, booking_id, variables)
  select distinct on (lower(o.email))
         'email', 'queued', 'owner', o.id, o.email, v_title, v_owner_body,
         new.unit_id, new.id, jsonb_build_object('portal', 'owner', 'link', v_owner_link)
    from unit_ownerships uo
    join owners o on o.id = uo.owner_id
   where uo.unit_id = new.unit_id
     and uo.end_date is null
     and o.is_active
     and o.email is not null
     and o.email <> '';

  return new;
end;
$$;

