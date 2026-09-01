-- ============================================================================
-- D|R|P PMS - 0013 Single-round-trip profile lookup
--
-- Every page needs the signed-in user's profile. Doing that as
-- supabase.auth.getUser() followed by a select on `profiles` costs two
-- sequential round trips to the Supabase region - noticeable when the project
-- is far from the operator, which it is for a Dubai/Colombo team on a US or EU
-- region.
--
-- This collapses it to one. It is no less safe: PostgREST verifies the JWT
-- signature before it sets request.jwt.claims, so auth.uid() here is exactly
-- as trustworthy as it is inside every RLS policy.
-- ============================================================================

create or replace function current_profile()
returns profiles
language sql
stable
security definer
set search_path = public, pms
as $$
  select * from profiles where id = auth.uid() and is_active;
$$;

revoke all on function current_profile() from public, anon;
grant execute on function current_profile() to authenticated;

comment on function current_profile() is
  'The signed-in user''s profile row, or no row when the session is invalid or '
  'the account is deactivated. One round trip instead of getUser() + select.';
