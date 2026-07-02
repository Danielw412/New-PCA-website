drop policy "Anyone can view published events and admins can view all" on public.events;

create policy "Public can view published events"
on public.events
for select
to anon
using (published = true);

create policy "Authenticated users can view published events and admins can view all"
on public.events
for select
to authenticated
using (
    published = true
    or exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);
