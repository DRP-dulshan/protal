-- ============================================================================
-- D|R|P PMS - 0024 Holiday-home units read "Listed (short-term)", not "Vacant"
--
-- A unit's status only ever changed with leases (0011 sync_unit_status), so a
-- unit added as a holiday home - every Airbnb listing - stayed "vacant" for
-- good, and the Properties page counted it as empty.
--
-- From now on the status follows the operating mode whenever nothing more
-- specific applies: a short-term (or both) unit that is not leased, under
-- maintenance, owner-occupied or off the market is "listed_short_term"; a
-- unit taken off short-term letting goes back to "vacant". Whether a guest is
-- in tonight is a matter of bookings and is shown from them, not stored.
-- ============================================================================

create or replace function pms.holiday_home_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'vacant' and new.operating_mode in ('short_term','both') then
    new.status := 'listed_short_term';
  elsif new.status = 'listed_short_term' and new.operating_mode not in ('short_term','both') then
    new.status := 'vacant';
  end if;
  return new;
end;
$$;

drop trigger if exists units_holiday_home_status on units;
create trigger units_holiday_home_status
  before insert or update of operating_mode, status on units
  for each row execute function pms.holiday_home_status();

-- Units already in the portal.
update units
   set status = 'listed_short_term'
 where status = 'vacant'
   and operating_mode in ('short_term','both');
