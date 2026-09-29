-- ============================================================================
-- D|R|P PMS - 0015 Company details
--
-- The company's legal name, address and contact details, as printed on the
-- owner statement letterhead. Only fields still at their placeholder or empty
-- are filled, so anything already entered in Company settings is kept. They
-- stay editable there afterwards.
-- ============================================================================

alter table company_settings
  alter column legal_name set default 'DRP Real Estate Brokers LLC';

update company_settings set
  legal_name = case when legal_name = 'D|R|P Real Estate'
                    then 'DRP Real Estate Brokers LLC' else legal_name end,
  registered_address = coalesce(nullif(registered_address, ''),
                                'DRP, Golden Mile 09, Palm Jumeirah, Dubai'),
  phone = coalesce(nullif(phone, ''), '+971 4 529 4904'),
  email = coalesce(nullif(email, ''), 'office@dubairapidproperties.com')
where id;
