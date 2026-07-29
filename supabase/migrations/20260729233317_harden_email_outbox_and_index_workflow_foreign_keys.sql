-- Make the outbox's browser denial explicit for auditing/linting. Table grants
-- remain revoked; this policy is defense in depth while service_role bypasses
-- RLS for the deployed email worker.
create policy "Browser identities cannot access transactional email deliveries"
on public.transactional_email_deliveries
as restrictive
for all
to anon, authenticated
using (false)
with check (false);

create index event_volunteer_requests_requester_idx
    on public.event_volunteer_requests (requester_user_id)
    where requester_user_id is not null;

create index event_volunteer_requests_linked_account_idx
    on public.event_volunteer_requests (linked_account_id)
    where linked_account_id is not null;

create index event_volunteer_requests_reviewed_by_idx
    on public.event_volunteer_requests (reviewed_by)
    where reviewed_by is not null;

create index events_deleted_by_idx
    on public.events (deleted_by)
    where deleted_by is not null;
