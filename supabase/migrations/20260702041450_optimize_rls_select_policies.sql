drop policy "Users can view their profile" on public.profiles;
drop policy "Admins can view profiles" on public.profiles;

create policy "Users and admins can view profiles"
on public.profiles
for select
to authenticated
using (
    id = (select auth.uid())
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

drop policy "Anyone can view published events" on public.events;
drop policy "Admins can view all events" on public.events;

create policy "Anyone can view published events and admins can view all"
on public.events
for select
to anon, authenticated
using (
    published = true
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

drop policy "Users can view their registrations" on public.registrations;
drop policy "Admins can view all registrations" on public.registrations;

create policy "Users and admins can view registrations"
on public.registrations
for select
to authenticated
using (
    account_id = (select auth.uid())
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

drop policy "Users can view their participants" on public.registration_participants;
drop policy "Admins can view all participants" on public.registration_participants;

create policy "Users and admins can view participants"
on public.registration_participants
for select
to authenticated
using (
    exists (
        select 1
        from public.registrations
        where registrations.id = registration_id
          and registrations.account_id = (select auth.uid())
    )
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);
