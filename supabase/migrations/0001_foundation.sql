-- ============================================================================
-- D|R|P PMS - 0001 Foundation: extensions, enums, helper schema
-- UAE / Dubai first. Base currency AED. Regulators: RERA/DLD (Ejari),
-- DET (formerly DTCM), Mollak. VAT 5% modelled per line item, never blanket.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "btree_gist";   -- date-range exclusion constraints

-- Private schema for security-definer helpers used by RLS policies.
create schema if not exists pms;
revoke all on schema pms from public;
grant usage on schema pms to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identity & access
-- ---------------------------------------------------------------------------
create type app_role as enum (
  'super_admin',
  'property_manager',
  'agent',            -- leasing / sales agent
  'owner',
  'tenant',
  'guest',
  'maintenance',      -- maintenance + housekeeping staff
  'finance',          -- accountant
  'marketing'         -- marketing / admin support
);

create type party_kind as enum ('owner','tenant','guest','vendor','staff','lead');

-- ---------------------------------------------------------------------------
-- Property & unit
-- ---------------------------------------------------------------------------
create type emirate as enum (
  'dubai','abu_dhabi','sharjah','ajman','umm_al_quwain','ras_al_khaimah','fujairah'
);

create type property_kind as enum (
  'building','villa_compound','standalone_villa','townhouse_cluster','mixed_use'
);

create type unit_kind as enum (
  'apartment','studio','villa','townhouse','penthouse','duplex','loft','office','retail'
);

create type furnishing_status as enum ('unfurnished','semi_furnished','fully_furnished');

-- Which line of business a unit is operated under.
create type operating_mode as enum ('long_term','short_term','both','not_operating');

create type unit_status as enum (
  'vacant',              -- available, no active lease/booking
  'occupied_long_term',
  'listed_short_term',
  'under_maintenance',
  'owner_occupied',
  'off_market'
);

-- ---------------------------------------------------------------------------
-- Leasing (long term)
-- ---------------------------------------------------------------------------
create type lease_status as enum (
  'draft','pending_signature','active','expiring','renewed','terminated','cancelled','expired'
);

create type ejari_status as enum ('not_registered','pending','registered','expired','cancelled');

create type rent_payment_method as enum ('cheque','bank_transfer','direct_debit','cash','card','online');

create type installment_status as enum (
  'scheduled','presented','cleared','bounced','part_paid','cancelled','written_off'
);

create type deposit_status as enum ('not_collected','held','partially_refunded','refunded','forfeited');

create type deposit_txn_kind as enum ('collected','deducted','refunded','forfeited');

create type notice_kind as enum (
  'renewal_offer','non_renewal','rent_increase','termination','eviction','breach','vacate_confirmation'
);

create type notice_status as enum ('draft','issued','acknowledged','contested','withdrawn','effected');

-- ---------------------------------------------------------------------------
-- Short term / Holiday Homes
-- ---------------------------------------------------------------------------
create type permit_status as enum ('draft','pending','active','expired','suspended','cancelled');

create type sales_channel as enum (
  'direct','airbnb','booking_com','vrbo','expedia','agoda','tripadvisor','other'
);

create type booking_status as enum (
  'inquiry','tentative','confirmed','checked_in','checked_out','cancelled','no_show'
);

create type block_reason as enum (
  'booking','maintenance','owner_stay','housekeeping','blocked','channel_sync'
);

create type housekeeping_kind as enum (
  'turnover','deep_clean','inspection','linen_change','restock','pre_arrival_check'
);

create type task_status as enum ('pending','assigned','in_progress','completed','verified','cancelled');

-- ---------------------------------------------------------------------------
-- Finance
-- ---------------------------------------------------------------------------
create type ledger_direction as enum ('income','expense');

create type invoice_kind as enum (
  'tenant_rent','owner_statement','management_fee','commission','service_order',
  'booking','service_charge','expense_recharge','other'
);

create type invoice_direction as enum ('receivable','payable');

create type invoice_status as enum ('draft','issued','part_paid','paid','overdue','void','written_off');

create type payment_direction as enum ('inbound','outbound');

create type payment_status as enum ('pending','processing','succeeded','failed','refunded','cancelled');

create type statement_status as enum ('draft','issued','approved','paid','void');

-- ---------------------------------------------------------------------------
-- Maintenance
-- ---------------------------------------------------------------------------
create type maintenance_category as enum (
  'air_conditioning','plumbing','electrical','appliance','carpentry','painting',
  'pest_control','cleaning','pool','landscaping','fire_safety','lift','handyman',
  'structural','other'
);

create type maintenance_priority as enum ('low','medium','high','emergency');

create type maintenance_status as enum (
  'submitted','acknowledged','awaiting_quote','awaiting_owner_approval','approved',
  'scheduled','in_progress','on_hold','completed','closed','rejected','cancelled'
);

create type cost_bearer as enum ('owner','tenant','drp','insurance','warranty');

-- ---------------------------------------------------------------------------
-- Documents & compliance
-- ---------------------------------------------------------------------------
create type document_kind as enum (
  'title_deed','ejari_certificate','tenancy_contract','det_permit','building_noc',
  'management_agreement','insurance_policy','emirates_id','passport','visa','trade_licence',
  'bank_letter','invoice','receipt','owner_statement','service_charge_invoice','dewa_bill',
  'inspection_report','handover_report','floor_plan','photo','poa','cheque_copy','other'
);

create type document_entity as enum (
  'company','property','unit','owner','tenant','guest','lease','booking','vendor',
  'maintenance_request','service_order','vehicle','management_agreement','permit'
);

create type compliance_kind as enum (
  'ejari_expiry','ejari_occupant_declaration','det_permit_expiry','building_noc_expiry',
  'management_agreement_expiry','insurance_expiry','emirates_id_expiry','passport_expiry',
  'trade_licence_expiry','lease_expiry','preventive_maintenance','vehicle_registration',
  'vehicle_insurance','document_expiry'
);

create type compliance_severity as enum ('ok','due_soon','urgent','overdue','missing');

-- ---------------------------------------------------------------------------
-- CRM / comms / add-ons
-- ---------------------------------------------------------------------------
create type lead_source as enum (
  'website','whatsapp','phone','walk_in','referral','bayut','property_finder',
  'dubizzle','instagram','ota','other'
);

create type lead_intent as enum (
  'long_term_rent','short_term_stay','buy_secondary','buy_off_plan','sell',
  'property_management','interior_design'
);

create type lead_stage as enum (
  'new','contacted','qualified','viewing_scheduled','application','negotiation','won','lost'
);

create type message_channel as enum ('whatsapp','email','sms','in_app');

create type message_direction as enum ('outbound','inbound');

create type message_status as enum ('queued','sent','delivered','read','failed','bounced');

create type service_order_kind as enum (
  'interior_design','furnishing','deep_clean','photography','staging','handyman_package','other'
);

create type service_order_status as enum (
  'requested','quoted','approved','in_progress','delivered','invoiced','cancelled'
);

create type vehicle_category as enum ('vip','staff','maintenance','guest_transfer','pool');

create type vehicle_booking_purpose as enum (
  'viewing','airport_transfer','client_transport','staff_use','maintenance_run','other'
);

create type audit_action as enum (
  'insert','update','delete','login','export','download','approve','reject'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function pms.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
