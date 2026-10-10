-- ============================================================================
-- D|R|P PMS - 0029 Holiday homes on the Holiday Homes website
--
-- The Holiday Homes website (drpholidayhomes / hh-drp) reads its homes from
-- the portal instead of keeping its own list:
--
--   * A holiday-home unit carries the website content next to its operating
--     data: title, photos, description, rules, amenities, map position and the
--     slug of its page. Rates (nightly, weekend, cleaning, weekly/monthly
--     discount) are the ones already on the unit (0020); seasonal rates are
--     new.
--   * "On the website" (website_published) is the switch. A published unit
--     must be a short-term unit with a title, photos, an area and a rate.
--   * Bookings made on the website arrive through website_book_unit() and
--     land in bookings (channel direct, website_ref = the website's own
--     reference), so the Airbnb export feed, the calendar and the double-
--     booking constraint all see them. website_set_booking_status() confirms
--     or cancels them as the guest pays or cancels.
--
-- Both functions are for the service role only (the portal's /api/public
-- routes): they trust their caller, who has already authenticated the
-- website with WEBSITE_API_KEY.
-- ============================================================================

alter table units
  add column website_published   boolean not null default false,
  add column website_slug        text,
  add column website_title       text,
  add column website_tag         text,
  add column website_type        text
    check (website_type is null or website_type in ('studio','apartment','penthouse','villa','townhouse')),
  -- One of the website's area names (Palm Jumeirah, Dubai Marina, JVT, ...).
  add column website_area        text,
  add column website_building    text,
  add column website_description text,
  add column website_highlights  text[] not null default '{}',
  add column website_house_rules text[] not null default '{}',
  -- Website amenity ids (pool, wifi, gym, ...).
  add column website_amenities   text[] not null default '{}',
  -- Photo URLs in display order; the first is the cover.
  add column website_images      jsonb not null default '[]'::jsonb
    check (jsonb_typeof(website_images) = 'array'),
  add column website_lat         numeric(9,6) check (website_lat is null or website_lat between -90 and 90),
  add column website_lng         numeric(9,6) check (website_lng is null or website_lng between -180 and 180),
  add column website_maps_url    text,
  add column website_check_in    text not null default '15:00' check (website_check_in ~ '^[0-2][0-9]:[0-5][0-9]$'),
  add column website_check_out   text not null default '11:00' check (website_check_out ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- [{"from":"2026-12-20","to":"2027-01-05","rate":1200,"name":"New Year"}] (both dates inclusive)
  add column website_seasons     jsonb not null default '[]'::jsonb
    check (jsonb_typeof(website_seasons) = 'array');

alter table units
  add constraint units_website_slug_format
    check (website_slug is null or (website_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(website_slug) <= 120));

create unique index units_website_slug_idx on units(website_slug) where website_slug is not null;

-- A unit only goes on the website once it can be shown and booked there.
alter table units
  add constraint units_website_ready
    check (
      not website_published
      or (
        website_slug is not null
        and website_title is not null and length(trim(website_title)) >= 3
        and website_area is not null
        and website_type is not null
        and jsonb_array_length(website_images) > 0
        and base_nightly_rate_aed is not null and base_nightly_rate_aed > 0
        and max_guests is not null and max_guests > 0
        and operating_mode in ('short_term','both')
      )
    );

comment on column units.website_published is 'Shown and bookable on the Holiday Homes website.';

alter table bookings
  add column website_ref text;
create unique index bookings_website_ref_idx on bookings(website_ref) where website_ref is not null;
comment on column bookings.website_ref is 'The Holiday Homes website''s booking reference (DRP-XXXXXX) for bookings made there.';

-- ---------------------------------------------------------------------------
-- Book a unit from the website. Serialised per unit; refuses a unit that is
-- blocked, already booked, not published or without a valid DET permit.
-- Errors carry a stable first word the API maps to HTTP statuses:
--   not_found, blocked, taken, no_permit, invalid
-- ---------------------------------------------------------------------------
create or replace function website_book_unit(
  p_slug          text,
  p_ref           text,
  p_check_in      date,
  p_check_out     date,
  p_adults        integer,
  p_guest_name    text,
  p_guest_email   text,
  p_guest_phone   text,
  p_nationality   text,
  p_status        booking_status,
  p_nightly       numeric,
  p_accommodation numeric,
  p_cleaning      numeric,
  p_tourism       numeric,
  p_gross         numeric,
  p_message       text,
  p_notes         text
)
returns table (booking_id uuid, booking_number text)
language plpgsql
set search_path = public, pms
as $$
declare
  v_unit   units%rowtype;
  v_guest  uuid;
  v_id     uuid;
  v_number text;
begin
  if p_status not in ('tentative','confirmed') then
    raise exception 'invalid: a website booking starts as tentative or confirmed';
  end if;
  if p_check_out <= p_check_in or p_adults < 1 then
    raise exception 'invalid: check the dates and guests';
  end if;

  -- Lock the unit so two bookings for the same nights cannot both pass the checks.
  select * into v_unit from units
   where website_slug = p_slug and website_published and is_active
   for update;
  if not found then
    raise exception 'not_found: that home is not available on the website';
  end if;
  if v_unit.max_guests is not null and p_adults > v_unit.max_guests then
    raise exception 'invalid: this home sleeps up to % guests', v_unit.max_guests;
  end if;
  if v_unit.min_nights > (p_check_out - p_check_in) then
    raise exception 'invalid: minimum stay is % nights', v_unit.min_nights;
  end if;

  -- Existing bookings, owner stays, maintenance and channel (Airbnb) holds all
  -- show up as calendar blocks.
  if exists (
    select 1 from availability_blocks
     where unit_id = v_unit.id and start_date < p_check_out and end_date > p_check_in
  ) then
    raise exception 'blocked: those dates are not available';
  end if;

  if not pms.unit_has_valid_permit(v_unit.id, p_check_in) then
    raise exception 'no_permit: this home has no valid DET permit for those dates';
  end if;

  insert into guests (full_name, email, phone, whatsapp, nationality)
  values (trim(p_guest_name), nullif(trim(p_guest_email), ''), nullif(trim(p_guest_phone), ''),
          nullif(trim(p_guest_phone), ''), nullif(trim(p_nationality), ''))
  returning id into v_guest;

  begin
    insert into bookings (
      booking_number, unit_id, guest_id, channel, status, website_ref,
      check_in, check_out, adults,
      nightly_rate_aed, accommodation_aed, cleaning_fee_aed, tourism_dirham_aed, gross_total_aed,
      payout_expected_aed, guest_message, internal_notes
    ) values (
      '', v_unit.id, v_guest, 'direct', p_status, p_ref,
      p_check_in, p_check_out, p_adults,
      p_nightly, p_accommodation, coalesce(p_cleaning, 0), coalesce(p_tourism, 0), p_gross,
      -- Tourism Dirham is collected for the government, not paid out.
      p_gross - coalesce(p_tourism, 0), nullif(p_message, ''), nullif(p_notes, '')
    )
    returning id, bookings.booking_number into v_id, v_number;
  exception
    when exclusion_violation then
      raise exception 'taken: those dates were just booked';
    when unique_violation then
      raise exception 'invalid: that booking reference already exists';
  end;

  return query select v_id, v_number;
end;
$$;

-- ---------------------------------------------------------------------------
-- Move a website booking along: tentative -> confirmed (paid), or cancelled.
-- Returns the booking's status afterwards.
-- ---------------------------------------------------------------------------
create or replace function website_set_booking_status(
  p_ref    text,
  p_status text,
  p_reason text default null
)
returns text
language plpgsql
set search_path = public, pms
as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where website_ref = p_ref for update;
  if not found then
    raise exception 'not_found: no booking with that reference';
  end if;

  if p_status = 'confirmed' then
    if v_booking.status in ('confirmed','checked_in','checked_out') then
      return v_booking.status::text;
    end if;
    if v_booking.status <> 'tentative' then
      raise exception 'invalid: a % booking cannot be confirmed', v_booking.status;
    end if;
    update bookings set status = 'confirmed' where id = v_booking.id;
    return 'confirmed';
  elsif p_status = 'cancelled' then
    if v_booking.status = 'cancelled' then
      return 'cancelled';
    end if;
    if v_booking.status not in ('inquiry','tentative','confirmed') then
      raise exception 'invalid: a % booking cannot be cancelled', v_booking.status;
    end if;
    update bookings
       set status = 'cancelled',
           cancelled_on = (now() at time zone 'Asia/Dubai')::date,
           cancellation_reason = left(coalesce(p_reason, 'Cancelled on the website'), 300)
     where id = v_booking.id;
    return 'cancelled';
  end if;

  raise exception 'invalid: status must be confirmed or cancelled';
end;
$$;

-- Only the portal's server (service role) calls these.
revoke all on function website_book_unit(text, text, date, date, integer, text, text, text, text, booking_status, numeric, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated;
revoke all on function website_set_booking_status(text, text, text) from public, anon, authenticated;
grant execute on function website_book_unit(text, text, date, date, integer, text, text, text, text, booking_status, numeric, numeric, numeric, numeric, numeric, text, text) to service_role;
grant execute on function website_set_booking_status(text, text, text) to service_role;
