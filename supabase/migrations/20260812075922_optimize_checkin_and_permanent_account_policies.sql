-- Cover the nullable auth.users foreign key used by check-in audit queries and
-- by auth-user deletion cascades/checks.
create index registration_checkins_checked_in_by_idx
    on private.registration_checkins (checked_in_by);

-- Keep the Data API surface as security-invoker wrappers. The private helpers
-- retain their SECURITY DEFINER authorization checks and empty search paths;
-- authenticated callers receive EXECUTE only on these five specific helpers.
alter function public.issue_registration_checkin_token(uuid) security invoker;
alter function public.issue_guest_registration_checkin_token(uuid, text) security invoker;
alter function public.lookup_registration_checkin(text) security invoker;
alter function public.check_in_event_registration(text) security invoker;
alter function public.check_in_registration_as_admin(uuid) security invoker;

revoke all on function private.issue_registration_checkin_token(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.issue_guest_registration_checkin_token(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.lookup_registration_checkin(text)
from public, anon, authenticated, service_role;
revoke all on function private.check_in_event_registration(text)
from public, anon, authenticated, service_role;
revoke all on function private.check_in_registration_as_admin(uuid)
from public, anon, authenticated, service_role;

grant execute on function private.issue_registration_checkin_token(uuid)
to authenticated;
grant execute on function private.issue_guest_registration_checkin_token(uuid, text)
to authenticated;
grant execute on function private.lookup_registration_checkin(text)
to authenticated;
grant execute on function private.check_in_event_registration(text)
to authenticated;
grant execute on function private.check_in_registration_as_admin(uuid)
to authenticated;

-- Anonymous Auth users intentionally use the authenticated Postgres role, so
-- the JWT claim remains the restrictive boundary. Select auth.jwt() directly
-- in the advisor-recognized initPlan form, then inspect its immutable
-- per-request result. This is logically identical to the existing policies.
alter policy "Permanent accounts only" on public.admin_users
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.profiles
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.household_members
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.registration_participants
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.registrations
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.teen_member_role_assignments
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.teen_volunteer_profiles
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.volunteer_applications
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.volunteer_assignments
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);

alter policy "Permanent accounts only" on public.volunteer_hours
using (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false)
with check (coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false);
