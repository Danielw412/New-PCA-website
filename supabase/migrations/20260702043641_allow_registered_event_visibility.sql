drop policy "Authenticated users can view published events and admins can view all"
on public.events;

create policy "Authenticated users can view available registered or admin events"
on public.events
for select
to authenticated
using (
    published = true
    or exists (
        select 1
        from public.registrations
        where registrations.event_id = events.id
          and registrations.account_id = (select auth.uid())
    )
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);
