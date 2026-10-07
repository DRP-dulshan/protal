-- ============================================================================
-- D|R|P PMS - 0027 Owners see the documents shared on their units
--
-- A document uploaded on a unit's page carries the unit, not an owner. The
-- read policy (0014) let an owner see an owner-visible document only when it
-- named one of their owner records, so every title deed, permit or NOC filed
-- on a unit stayed hidden from its owner even with "Owner can see" ticked.
--
-- Now an owner-visible document on a unit the owner currently owns is theirs
-- to read as well. Everything else is unchanged: sensitive files stay with
-- their own party, income documents stay hidden from owners, and tenants and
-- guests keep their own rule.
-- ============================================================================

drop policy if exists documents_read on documents;
create policy documents_read on documents
  for select to authenticated
  using (
    case
      when is_sensitive then
        pms.my_role() in ('super_admin','property_manager','finance')
        or (owner_id is not null and owner_id in (select pms.my_owner_ids()))
      else
        (unit_id is not null and pms.can_read_unit(unit_id))
        or (owner_id is not null and owner_id in (select pms.my_owner_ids()))
        or (entity_kind = 'company' and pms.is_staff())
        or uploaded_by = auth.uid()
    end
    and (
      pms.is_staff()
      or (is_owner_visible and owner_id in (select pms.my_owner_ids()))
      or (is_owner_visible and unit_id is not null and pms.owns_unit(unit_id))
      or (is_tenant_visible and unit_id is not null and (pms.tenants_unit(unit_id) or pms.stays_in_unit(unit_id)))
      or uploaded_by = auth.uid()
    )
    and (pms.my_role() is distinct from 'owner' or not pms.is_income_document(kind))
  );
