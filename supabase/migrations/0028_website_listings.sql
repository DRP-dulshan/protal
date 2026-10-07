-- ============================================================================
-- D|R|P PMS - 0028 Website listings
--
-- The sale and rental listings shown on the D|R|P website (Buy / Rent, the
-- /properties pages) are kept here and edited in the admin portal. The
-- website reads the published ones from /api/public/listings when it is
-- built, in the shape its own data file uses, so its pages need no change.
--
--   * A listing is a draft until published; "hidden" takes it off the
--     website without deleting it.
--   * Columns follow the website's Listing type: offering buy/rent, price in
--     AED (a year's rent for rentals), type, area, building, beds (0 =
--     studio), baths, size in sq ft, completion, furnishing, agent, photos,
--     description, features, the DLD advertising permit.
--   * A listing may point at a unit the portal manages; most sale listings
--     are other people's properties and do not.
--   * Photos uploaded in the portal go to the public bucket listing-photos,
--     so the website can show them without signing in.
--
-- Staff read every listing; super admins, property managers, agents and
-- marketing edit them. Owners, tenants and guests see none of this table.
-- ============================================================================

create table website_listings (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique
                  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 120),
  status        text not null default 'draft'
                  check (status in ('draft', 'published', 'hidden')),
  title         text not null check (length(trim(title)) between 3 and 200),
  offering      text not null check (offering in ('buy', 'rent')),
  -- Sale price, or a year's rent for a rental.
  price_aed     numeric(14,2) not null check (price_aed > 0),
  property_type text not null check (property_type in ('Apartment', 'Penthouse', 'Townhouse', 'Villa')),
  area          text not null check (length(trim(area)) > 0),
  building      text,
  -- What the website's map searches for, and whether that finds the
  -- building itself (true) or only the community.
  map_query     text,
  map_exact     boolean not null default false,
  beds          integer not null default 0 check (beds between 0 and 20),
  baths         integer not null default 1 check (baths between 0 and 20),
  size_sqft     integer not null check (size_sqft > 0),
  completion    text not null default 'Ready' check (completion in ('Ready', 'Off-Plan')),
  furnishing    text check (furnishing in ('Furnished', 'Unfurnished')),
  listed_at     date not null default ((now() at time zone 'Asia/Dubai')::date),
  agent         text,
  -- Photo URLs in display order; the first is the cover.
  images        jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  -- Paragraphs separated by a blank line.
  description   text not null default '',
  features      text[] not null default '{}',
  -- Property Finder reference and the DLD advertising permit.
  ref           text,
  permit        text,
  source_url    text,
  unit_id       uuid references units(id) on delete set null,
  created_by    uuid references profiles(id) on delete set null,
  updated_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index website_listings_status_idx on website_listings(status, offering);
create index website_listings_unit_idx on website_listings(unit_id);

create trigger website_listings_touch before update on website_listings
  for each row execute function pms.touch_updated_at();

comment on table website_listings is
  'Sale and rental listings for the D|R|P website, edited in the admin portal and read by /api/public/listings.';

-- ---------------------------------------------------------------------------
-- Who may edit
-- ---------------------------------------------------------------------------
create or replace function pms.can_edit_listings()
returns boolean
language sql
stable
security definer
set search_path = public, pms
as $$
  select coalesce(pms.my_role() in ('super_admin', 'property_manager', 'agent', 'marketing'), false);
$$;

alter table website_listings enable row level security;

create policy website_listings_read on website_listings
  for select to authenticated using (pms.is_staff());

create policy website_listings_insert on website_listings
  for insert to authenticated with check (pms.can_edit_listings());

create policy website_listings_update on website_listings
  for update to authenticated
  using (pms.can_edit_listings()) with check (pms.can_edit_listings());

create policy website_listings_delete on website_listings
  for delete to authenticated using (pms.can_edit_listings());

grant select, insert, update, delete on website_listings to authenticated;
grant all on website_listings to service_role;
grant execute on function pms.can_edit_listings() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Photos: a public bucket, written only by listing editors
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-photos', 'listing-photos', true, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
on conflict (id) do nothing;

drop policy if exists "listing photos upload by listing editors" on storage.objects;
create policy "listing photos upload by listing editors"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'listing-photos' and pms.can_edit_listings());

drop policy if exists "listing photos delete by listing editors" on storage.objects;
create policy "listing photos delete by listing editors"
  on storage.objects for delete to authenticated
  using (bucket_id = 'listing-photos' and pms.can_edit_listings());
