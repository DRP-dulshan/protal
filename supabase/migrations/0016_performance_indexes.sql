-- ============================================================================
-- D|R|P PMS - 0016 Indexes for the columns RLS, triggers and pages filter on
--
-- Found by listing every foreign key without a supporting index and keeping
-- the ones something actually reads by. Audit columns (created_by,
-- recorded_by ...) are deliberately left alone: nothing filters on them, and
-- an index there would only slow writes.
--
-- Safe to re-run. The tables are small enough that plain CREATE INDEX (which
-- runs inside the SQL editor's transaction) finishes instantly.
-- ============================================================================

-- Booking triggers: pms.sync_booking_block() deletes by booking_id and
-- pms.schedule_turnover() probes by booking_id on every booking write.
create index if not exists availability_blocks_booking_idx on availability_blocks(booking_id);
create index if not exists housekeeping_booking_idx on housekeeping_tasks(booking_id);
create index if not exists housekeeping_next_booking_idx on housekeeping_tasks(next_booking_id);

-- Calendars and the owner booking view filter a unit's stays by date range.
create index if not exists bookings_unit_checkin_idx on bookings(unit_id, check_in);

-- Columns RLS policies resolve through.
create index if not exists compliance_alerts_unit_idx on compliance_alerts(unit_id);
create index if not exists compliance_alerts_owner_idx on compliance_alerts(owner_id);
create index if not exists payments_unit_idx on payments(unit_id);
create index if not exists service_orders_owner_idx on service_orders(owner_id);
create index if not exists pm_plans_unit_idx on preventive_maintenance_plans(unit_id);
create index if not exists pm_plans_property_idx on preventive_maintenance_plans(property_id);

-- Detail pages: a lease's or booking's money and tickets.
create index if not exists ledger_lease_idx on ledger_entries(lease_id) where lease_id is not null;
create index if not exists ledger_booking_idx on ledger_entries(booking_id) where booking_id is not null;
create index if not exists invoices_lease_idx on invoices(lease_id) where lease_id is not null;
create index if not exists invoices_booking_idx on invoices(booking_id) where booking_id is not null;
create index if not exists payments_lease_idx on payments(lease_id) where lease_id is not null;
create index if not exists payments_booking_idx on payments(booking_id) where booking_id is not null;
create index if not exists maintenance_lease_idx on maintenance_requests(lease_id) where lease_id is not null;
create index if not exists maintenance_booking_idx on maintenance_requests(booking_id) where booking_id is not null;
