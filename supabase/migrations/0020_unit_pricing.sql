-- ============================================================================
-- D|R|P PMS - 0020 Holiday home pricing for direct bookings
--
-- The prices D|R|P quotes for a direct booking, kept on the unit next to the
-- base nightly rate:
--
--   weekend_rate_aed      Friday and Saturday nights (as Airbnb's weekend
--                         price). Empty: the nightly rate applies.
--   cleaning_fee_aed      Charged once per stay.
--   weekly_discount_pct   Off the nights' total for stays of 7-27 nights.
--   monthly_discount_pct  Off the nights' total for stays of 28+ nights.
--
-- Airbnb stays are priced by Airbnb itself (earnings import); these are only
-- defaults for the New booking form, which staff can still change.
-- ============================================================================

alter table units
  add column if not exists weekend_rate_aed numeric(10,2) check (weekend_rate_aed is null or weekend_rate_aed >= 0),
  add column if not exists cleaning_fee_aed numeric(10,2) check (cleaning_fee_aed is null or cleaning_fee_aed >= 0),
  add column if not exists weekly_discount_pct numeric(5,2)
    check (weekly_discount_pct is null or (weekly_discount_pct >= 0 and weekly_discount_pct < 100)),
  add column if not exists monthly_discount_pct numeric(5,2)
    check (monthly_discount_pct is null or (monthly_discount_pct >= 0 and monthly_discount_pct < 100));

comment on column units.weekend_rate_aed is 'Friday and Saturday nights; null = base nightly rate.';
comment on column units.weekly_discount_pct is 'Percent off the nights for stays of 7 to 27 nights.';
comment on column units.monthly_discount_pct is 'Percent off the nights for stays of 28 nights or more.';
