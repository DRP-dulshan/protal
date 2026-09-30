-- ============================================================================
-- D|R|P PMS - 0019 Complaints and repairs
--
-- One queue for both: repairs (AC, plumbing ...) and complaints (noise,
-- cleaning, neighbours ...). Staff raise tickets for any unit they manage -
-- including ones a tenant or guest phoned in - and owners raise them for
-- their own units from the owner portal. Both sides follow the status and
-- the conversation.
--
--   * maintenance_requests.kind tells a repair from a complaint, with a few
--     complaint categories added.
--   * Owners raise tickets only through raise_owner_ticket(), which fixes
--     who raised it and its starting status. The direct insert is staff only.
--   * An owner may change nothing on a ticket but their approval decision.
--   * Notes: anyone who can see a ticket may add a note in their own name;
--     only staff write internal notes or change them afterwards.
--   * New tickets and status changes notify staff and the unit's owners in
--     the portal, never the person who made the change.
-- ============================================================================

alter type maintenance_category add value if not exists 'noise';
alter type maintenance_category add value if not exists 'neighbours';
alter type maintenance_category add value if not exists 'security';
alter type maintenance_category add value if not exists 'internet_tv';
alter type maintenance_category add value if not exists 'service';

alter table maintenance_requests
  add column if not exists kind text not null default 'repair'
    check (kind in ('repair', 'complaint'));

comment on column maintenance_requests.kind is
  'repair: something to fix. complaint: a service or behaviour issue (noise, cleaning, neighbours).';

-- ---------------------------------------------------------------------------
-- Who may raise a ticket
-- ---------------------------------------------------------------------------
drop policy if exists maintenance_insert on maintenance_requests;
create policy maintenance_insert on maintenance_requests
  for insert to authenticated
  with check (pms.is_staff() and pms.can_read_unit(unit_id));

create or replace function raise_owner_ticket(
  p_unit_id uuid,
  p_kind text,
  p_category maintenance_category,
  p_priority maintenance_priority,
  p_title text,
  p_description text default null,
  p_access_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_id uuid;
begin
  if pms.my_role() is distinct from 'owner' or not pms.owns_unit(p_unit_id) then
    raise exception 'You can only report issues for your own properties'
      using errcode = 'insufficient_privilege';
  end if;
  if p_kind is null or p_kind not in ('repair', 'complaint') then
    raise exception 'Unknown ticket kind %', p_kind using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_title, ''))) = 0 or length(p_title) > 150 then
    raise exception 'A short title is required' using errcode = 'check_violation';
  end if;

  insert into maintenance_requests
    (unit_id, kind, category, priority, title, description, access_notes,
     raised_by, raised_by_kind, status)
  values
    (p_unit_id, p_kind, coalesce(p_category, 'other'), coalesce(p_priority, 'medium'),
     trim(p_title),
     nullif(left(trim(coalesce(p_description, '')), 4000), ''),
     nullif(left(trim(coalesce(p_access_notes, '')), 1000), ''),
     auth.uid(), 'owner', 'submitted')
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function raise_owner_ticket(uuid, text, maintenance_category, maintenance_priority, text, text, text) from public, anon;
grant execute on function raise_owner_ticket(uuid, text, maintenance_category, maintenance_priority, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- What an owner may change: their approval decision, nothing else
-- ---------------------------------------------------------------------------
create or replace function pms.guard_owner_ticket_update()
returns trigger
language plpgsql
set search_path = public, pms
as $$
declare
  c_decision constant text[] := array[
    'status', 'owner_approved_at', 'owner_approved_by', 'approved_amount_aed',
    'owner_rejected_at', 'owner_rejection_reason', 'updated_at'];
begin
  if pms.is_staff() or auth.uid() is null then
    return new;
  end if;

  if (to_jsonb(new) - c_decision) is distinct from (to_jsonb(old) - c_decision)
     or new.status not in ('approved', 'rejected')
     or (new.owner_approved_by is not null and new.owner_approved_by <> auth.uid()) then
    raise exception 'Owners can only approve or decline a quote'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

drop trigger if exists maintenance_owner_guard on maintenance_requests;
create trigger maintenance_owner_guard
  before update on maintenance_requests
  for each row execute function pms.guard_owner_ticket_update();

-- ---------------------------------------------------------------------------
-- Notes on a ticket
-- ---------------------------------------------------------------------------
drop policy if exists maintenance_updates_write on maintenance_updates;

create policy maintenance_updates_insert on maintenance_updates
  for insert to authenticated
  with check (
    exists (select 1 from maintenance_requests r where r.id = maintenance_updates.request_id)
    and author_id = auth.uid()
    and (pms.is_staff() or (not is_internal and status_from is null and status_to is null))
  );

create policy maintenance_updates_manage on maintenance_updates
  for update to authenticated
  using (pms.is_manager()) with check (pms.is_manager());

create policy maintenance_updates_delete on maintenance_updates
  for delete to authenticated
  using (pms.is_manager());

-- ---------------------------------------------------------------------------
-- Notifications for tickets
-- ---------------------------------------------------------------------------
alter table notifications drop constraint if exists notifications_kind_check;
alter table notifications add constraint notifications_kind_check
  check (kind in ('booking_new', 'booking_changed', 'booking_cancelled',
                  'ticket_new', 'ticket_status'));

alter table notifications
  add column if not exists ticket_id uuid references maintenance_requests(id) on delete cascade;

create or replace function pms.notify_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = public, pms
as $$
declare
  v_kind   text;
  v_unit   record;
  v_what   text;
  v_title  text;
  v_body   text;
  v_actor  uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    v_kind := 'ticket_new';
  elsif new.status is distinct from old.status then
    v_kind := 'ticket_status';
  else
    return new;
  end if;

  select u.id, u.unit_number, u.property_id, p.name as property_name
    into v_unit
    from units u
    join properties p on p.id = u.property_id
   where u.id = new.unit_id;

  v_what := case new.kind when 'complaint' then 'complaint' else 'repair' end;

  if v_kind = 'ticket_new' then
    v_title := 'New ' || v_what || ': ' || v_unit.property_name || ' ' || v_unit.unit_number;
    v_body  := new.ticket_number || ' - ' || new.title
               || case new.raised_by_kind
                    when 'owner' then ' (reported by the owner)'
                    when 'tenant' then ' (reported by the tenant)'
                    when 'guest' then ' (reported by a guest)'
                    else '' end
               || '.';
  else
    v_title := initcap(v_what) || ' ' || new.ticket_number || ': '
               || replace(initcap(replace(new.status::text, '_', ' ')), 'Owner', 'owner');
    v_body  := new.title || ' - ' || v_unit.property_name || ' ' || v_unit.unit_number || '.';
  end if;

  -- Staff: super admins, the assignee, and staff assigned to the unit or
  -- its property.
  insert into notifications (recipient_id, kind, title, body, link, unit_id, ticket_id)
  select p.id, v_kind, v_title, v_body, '/maintenance/' || new.id, new.unit_id, new.id
    from profiles p
   where p.is_active
     and p.id is distinct from v_actor
     and (p.role = 'super_admin'
          or p.id = new.assigned_to
          or (p.role in ('property_manager', 'agent', 'maintenance')
              and (exists (select 1 from staff_unit_assignments a
                            where a.profile_id = p.id and a.unit_id = new.unit_id)
                   or exists (select 1 from staff_property_assignments a
                               where a.profile_id = p.id and a.property_id = v_unit.property_id))));

  -- Owners of the unit.
  insert into notifications (recipient_id, kind, title, body, link, unit_id, ticket_id)
  select distinct p.id, v_kind, v_title, v_body, '/portal/owner/maintenance/' || new.id,
         new.unit_id, new.id
    from unit_ownerships uo
    join owner_users ou on ou.owner_id = uo.owner_id
    join profiles p on p.id = ou.profile_id
   where uo.unit_id = new.unit_id
     and uo.end_date is null
     and p.is_active
     and p.role = 'owner'
     and p.id is distinct from v_actor;

  return new;
end;
$$;

drop trigger if exists maintenance_notify on maintenance_requests;
create trigger maintenance_notify
  after insert or update of status on maintenance_requests
  for each row execute function pms.notify_ticket_event();
