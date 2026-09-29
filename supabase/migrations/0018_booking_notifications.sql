-- ============================================================================
-- D|R|P PMS - 0018 Booking notifications
--
-- When a stay is booked, moved or cancelled - from the Airbnb feed or by
-- staff - D|R|P and the unit's owners hear about it straight away:
--
--   * in the portal: a row in `notifications` for each recipient's login
--   * by email: a queued row in `messages`, sent by the app (lib/notify)
--
-- Owners are told the unit, the dates, the nights and the channel. Never an
-- amount: owner financial isolation (0014) holds for notifications too. The
-- guest's first name is included only when company settings allow it.
--
-- Not announced: stays already over, and the first read of a newly linked
-- Airbnb calendar, which would otherwise report every existing reservation
-- at once.
-- ============================================================================

create table notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references profiles(id) on delete cascade,
  kind         text not null
                 check (kind in ('booking_new', 'booking_changed', 'booking_cancelled')),
  title        text not null,
  body         text not null,
  -- Path inside the recipient's own portal.
  link         text,
  booking_id   uuid references bookings(id) on delete cascade,
  unit_id      uuid references units(id) on delete cascade,
  created_at   timestamptz not null default now(),
  read_at      timestamptz
);
create index notifications_recipient_idx on notifications(recipient_id, created_at desc);
create index notifications_unread_idx on notifications(recipient_id) where read_at is null;

alter table notifications enable row level security;
alter table notifications force row level security;

-- Everyone sees and marks read their own notifications, nothing else. Rows
-- are written only by the trigger below.
create policy notifications_own_read on notifications
  for select to authenticated using (recipient_id = auth.uid());
create policy notifications_own_mark_read on notifications
  for update to authenticated
  using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

revoke all on notifications from anon;
revoke insert, update, delete on notifications from authenticated;
grant select on notifications to authenticated;
grant update (read_at) on notifications to authenticated;
grant all on notifications to service_role;

-- ---------------------------------------------------------------------------
-- The trigger
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
  if new.ical_uid is not null and v_unit.ical_last_synced_at is null then
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

create trigger bookings_notify
  after insert or update of status, check_in, check_out on bookings
  for each row execute function pms.notify_booking_event();
