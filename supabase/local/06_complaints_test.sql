-- ============================================================================
-- D|R|P PMS - Complaints and repairs (0019)
--
-- Reuses the 02 fixtures: unit 2807 (Marina Gate 1) owned by owner B
-- (44444444-...), owner A (33333333-...) who does not own it, the property
-- manager assigned to Marina Gate 1 (22222222-...) and a tenant (55555555-...).
--
-- Run with: psql -v ON_ERROR_STOP=1 -f supabase/local/06_complaints_test.sql
-- ============================================================================

\set QUIET on
set client_min_messages = notice;

create or replace function pg_temp.n(who text, ticket uuid, k text) returns integer
language sql as $$
  select count(*)::int from notifications n join profiles p on p.id = n.recipient_id
   where p.email = who and n.ticket_id = ticket and n.kind = k
$$;

-- ---------------------------------------------------------------------------
-- TEST 38 - an owner reports a complaint on their own unit; staff hear of
-- it, the owner (who raised it) does not. Other owners and tenants cannot.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  t uuid;
  refused boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  t := raise_owner_ticket(v_unit, 'complaint', 'noise', 'high',
                          '  Loud music from next door  ', 'Every night after 11pm', null);
  reset role;

  assert (select kind from maintenance_requests where id = t) = 'complaint', 'kind stored';
  assert (select raised_by from maintenance_requests where id = t) = '44444444-4444-4444-4444-444444444444',
    'raised by the owner';
  assert (select raised_by_kind::text from maintenance_requests where id = t) = 'owner', 'raised_by_kind owner';
  assert (select status::text from maintenance_requests where id = t) = 'submitted', 'starts submitted';
  assert (select title from maintenance_requests where id = t) = 'Loud music from next door', 'title trimmed';
  assert (select ticket_number from maintenance_requests where id = t) <> '', 'ticket numbered';

  assert pg_temp.n('admin@drp.ae', t, 'ticket_new') = 1, 'super admin notified';
  assert pg_temp.n('pm@drp.ae', t, 'ticket_new') = 1, 'assigned PM notified';
  assert pg_temp.n('owner.b@example.com', t, 'ticket_new') = 0, 'the owner who raised it is not notified';
  assert pg_temp.n('finance@drp.ae', t, 'ticket_new') = 0, 'unassigned staff not notified';

  -- Owner A does not own 2807.
  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);
    perform raise_owner_ticket(v_unit, 'repair', 'plumbing', 'medium', 'Leak', null, null);
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'owner A refused on a unit they do not own';

  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);
    perform raise_owner_ticket(v_unit, 'repair', 'plumbing', 'medium', 'Leak', null, null);
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'a tenant cannot use the owner route';

  raise notice 'TEST 38  PASS  owner raises a complaint: admin + PM notified, not the owner; others refused';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 39 - owners cannot insert tickets directly (status, assignee, amounts
-- would be theirs to choose); staff can, and the owner hears of it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_unit uuid := (select id from units where unit_number = '2807');
  refused boolean := false;
  t uuid;
begin
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
    insert into maintenance_requests (ticket_number, unit_id, title, status)
    values ('', v_unit, 'Sneaky', 'closed');
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'owner direct insert refused by RLS';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into maintenance_requests (ticket_number, unit_id, kind, category, title, raised_by, raised_by_kind)
  values ('', v_unit, 'repair', 'air_conditioning', 'AC blowing warm air (T39)', auth.uid(), 'tenant')
  returning id into t;
  reset role;

  assert pg_temp.n('owner.b@example.com', t, 'ticket_new') = 1, 'owner told of a staff-raised ticket';
  assert pg_temp.n('pm@drp.ae', t, 'ticket_new') = 0, 'the PM who raised it is not notified';
  assert (select body from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'owner.b@example.com' and n.ticket_id = t) ~ 'reported by the tenant',
    'body says who reported it';
  raise notice 'TEST 39  PASS  owner direct insert refused; staff ticket notifies the owner';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 40 - status changes reach the owner; the staff member who made the
-- change is not told of their own change.
-- ---------------------------------------------------------------------------
do $$
declare
  t uuid := (select id from maintenance_requests where title = 'AC blowing warm air (T39)');
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  update maintenance_requests set status = 'in_progress' where id = t;
  update maintenance_requests set priority = 'high' where id = t;   -- not a status change
  reset role;

  assert pg_temp.n('owner.b@example.com', t, 'ticket_status') = 1, 'owner told of the status change';
  assert pg_temp.n('admin@drp.ae', t, 'ticket_status') = 1, 'admin told';
  assert pg_temp.n('pm@drp.ae', t, 'ticket_status') = 0, 'actor not told';
  assert (select title from notifications n join profiles p on p.id = n.recipient_id
           where p.email = 'owner.b@example.com' and n.ticket_id = t and n.kind = 'ticket_status') ~ 'In Progress',
    'title names the new status';
  raise notice 'TEST 40  PASS  status change notifies owner and admin, not the actor; other edits silent';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 41 - on a ticket waiting for their approval, an owner can approve or
-- decline and change nothing else.
-- ---------------------------------------------------------------------------
do $$
declare
  t uuid := (select id from maintenance_requests where title = 'AC blowing warm air (T39)');
  refused boolean := false;
begin
  update maintenance_requests
     set status = 'awaiting_owner_approval', quoted_amount_aed = 50000, cost_borne_by = 'owner'
   where id = t;
  assert (select owner_approval_required from maintenance_requests where id = t), 'approval required';

  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
    update maintenance_requests set quoted_amount_aed = 1 where id = t;
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'owner cannot change the quote';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  update maintenance_requests
     set owner_approved_at = now(), owner_approved_by = auth.uid(),
         approved_amount_aed = 50000, status = 'approved'
   where id = t;
  reset role;
  assert (select status::text from maintenance_requests where id = t) = 'approved', 'owner approval recorded';
  raise notice 'TEST 41  PASS  owner may approve a quote but not edit the ticket';
end $$;

-- ---------------------------------------------------------------------------
-- TEST 42 - notes: an owner writes public notes in their own name only;
-- internal notes are staff-only to write and to read; owners cannot delete.
-- ---------------------------------------------------------------------------
do $$
declare
  t uuid := (select id from maintenance_requests where title = 'Loud music from next door');
  refused boolean;
  n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  insert into maintenance_updates (request_id, author_id, note)
  values (t, auth.uid(), 'It happened again last night');
  reset role;

  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
    insert into maintenance_updates (request_id, author_id, note, is_internal)
    values (t, auth.uid(), 'secret', true);
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'owner cannot write an internal note';

  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
    insert into maintenance_updates (request_id, author_id, note)
    values (t, '22222222-2222-2222-2222-222222222222', 'pretending to be the PM');
  exception when insufficient_privilege then refused := true;
  end;
  reset role;
  assert refused, 'owner cannot write as someone else';

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
  insert into maintenance_updates (request_id, author_id, note, is_internal)
  values (t, auth.uid(), 'Building security informed', true);
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);
  select count(*) into n from maintenance_updates where request_id = t;
  delete from maintenance_updates where request_id = t;
  reset role;
  assert n = 1, 'owner sees only the public note, got ' || n;
  assert (select count(*) from maintenance_updates where request_id = t) = 2, 'owner delete removed nothing';
  raise notice 'TEST 42  PASS  notes: owner public notes only, own name only, internal hidden, no deletes';
end $$;
