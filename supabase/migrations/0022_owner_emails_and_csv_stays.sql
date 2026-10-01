-- ============================================================================
-- D|R|P PMS - 0022 Owner booking emails switch; current and upcoming stays
-- from the earnings export
--
-- 1. company_settings.email_owners_about_bookings (default off)
--    The booking trigger (0018) queues an email to each owner for every new,
--    moved or cancelled stay. Until D|R|P has introduced owners to the
--    portal those emails stay unsent: a gate on `messages` drops booking
--    emails addressed to owners while the switch is off. Owners still get
--    the in-portal notification, and the office email is unchanged.
--
-- 2. bookings.import_source
--    'earnings_csv' marks a stay added from Airbnb's earnings export. Like
--    the first read of a newly linked calendar, a bulk import is not news,
--    so adding one announces nothing; later changes to it (a cancellation)
--    are announced as usual.
--
-- 3. Permit gate: an Airbnb stay from the earnings export is recorded even
--    without a permit for its dates and flagged imported_without_permit,
--    exactly as the calendar sync does - Airbnb has already taken the guest,
--    and refusing to record the stay would only hide it.
-- ============================================================================

alter table company_settings
  add column if not exists email_owners_about_bookings boolean not null default false;

comment on column company_settings.email_owners_about_bookings is
  'When false, booking emails to owners are not sent (portal notifications still are).';

alter table bookings
  add column if not exists import_source text
    check (import_source is null or import_source in ('earnings_csv'));

comment on column bookings.import_source is
  'How a stay entered the portal when not by hand or the calendar feed: earnings_csv.';

-- ---------------------------------------------------------------------------
-- 1. Owner booking emails off unless switched on
-- ---------------------------------------------------------------------------
create or replace function pms.gate_owner_booking_email()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
begin
  if not coalesce((select email_owners_about_bookings from company_settings where id), false) then
    return null; -- not queued
  end if;
  return new;
end;
$$;

drop trigger if exists messages_owner_booking_email_gate on messages;
create trigger messages_owner_booking_email_gate
  before insert on messages
  for each row
  when (new.channel = 'email' and new.party_kind = 'owner' and new.booking_id is not null)
  execute function pms.gate_owner_booking_email();

-- ---------------------------------------------------------------------------
-- 2. A stay added from the earnings export is not announced
-- ---------------------------------------------------------------------------
drop trigger if exists bookings_notify on bookings;
drop trigger if exists bookings_notify_insert on bookings;
drop trigger if exists bookings_notify_update on bookings;

create trigger bookings_notify_insert
  after insert on bookings
  for each row
  when (new.import_source is null)
  execute function pms.notify_booking_event();

create trigger bookings_notify_update
  after update of status, check_in, check_out on bookings
  for each row execute function pms.notify_booking_event();

-- ---------------------------------------------------------------------------
-- 3. Permit gate (0017) with the earnings export alongside the calendar feed
-- ---------------------------------------------------------------------------
create or replace function pms.enforce_permit_before_booking()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('tentative','confirmed','checked_in') then
    if not pms.unit_has_valid_permit(new.unit_id, new.check_in) then
      if new.channel = 'airbnb'
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
