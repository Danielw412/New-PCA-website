create policy "Admins can create events"
on public.events
for insert
to authenticated
with check (
    exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

grant insert on table public.events to authenticated;

comment on policy "Admins can create events" on public.events is
    'Allows authenticated accounts listed in admin_users to create events from the website admin dashboard.';
