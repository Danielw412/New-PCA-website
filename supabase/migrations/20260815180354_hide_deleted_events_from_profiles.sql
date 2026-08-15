-- Keep soft-deleted events available to administrators for registration and
-- audit history, but do not let an old registration or assignment make the
-- event visible in a household or volunteer profile.
drop policy if exists "Authenticated users can view active registered assigned or admin events"
on public.events;

create policy "Authenticated users can view active registered assigned or admin events"
on public.events
for select
to authenticated
using (
    (
        deleted_at is null
        and (
            published = true
            or exists (
                select 1
                from public.registrations
                where registrations.event_id = events.id
                  and registrations.account_id = (select auth.uid())
            )
            or exists (
                select 1
                from public.volunteer_assignments
                where volunteer_assignments.event_id = events.id
                  and volunteer_assignments.volunteer_user_id = (select auth.uid())
            )
        )
    )
    or private.is_site_administrator()
);

comment on policy "Authenticated users can view active registered assigned or admin events" on public.events is
    'Registered and assigned users can see only active events; administrators retain access to archived event history.';
