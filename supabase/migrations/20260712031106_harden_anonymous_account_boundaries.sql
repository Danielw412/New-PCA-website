alter function public.get_account_context() security invoker;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

create policy "Permanent accounts only"
on public.admin_users
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.profiles
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.household_members
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.registration_participants
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.registrations
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.teen_member_role_assignments
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.teen_volunteer_profiles
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.volunteer_applications
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.volunteer_assignments
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);

create policy "Permanent accounts only"
on public.volunteer_hours
as restrictive
for all
to authenticated
using (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false)
with check (coalesce((select (auth.jwt() ->> 'is_anonymous')::boolean), false) is false);
