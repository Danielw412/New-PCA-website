-- Keep event capacity and waitlist state consistent across every write path.
-- Registration RPCs lock the event row before changing confirmed attendance;
-- this trigger therefore serializes safely with registration changes.
create function private.enforce_event_capacity_floor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    confirmed_participant_count integer;
begin
    select coalesce(sum(registrations.participant_count), 0)::integer
    into confirmed_participant_count
    from public.registrations
    where registrations.event_id = new.id
      and registrations.status = 'confirmed';

    if new.capacity < confirmed_participant_count then
        raise exception
            'Capacity cannot be lower than the % attendees who are already confirmed.',
            confirmed_participant_count
            using errcode = '23514';
    end if;

    return new;
end;
$$;

revoke all on function private.enforce_event_capacity_floor()
from public, anon, authenticated, service_role;

-- Promotion is a state change that families need to hear about. Extend the
-- existing outbox allow-list and replace the FIFO promoter so every newly
-- confirmed group receives one idempotent delivery record in the same
-- transaction as its status change.
alter table public.transactional_email_deliveries
    drop constraint if exists transactional_email_deliveries_email_kind_check,
    add constraint transactional_email_deliveries_email_kind_check check (email_kind in (
        'event_registration_confirmation',
        'event_waitlist_promoted',
        'volunteer_request_received',
        'volunteer_request_approved',
        'volunteer_account_submitted_admin',
        'volunteer_account_submitted_volunteer',
        'volunteer_account_approved'
    ));

-- All current registration rows pass this preflight. Make the invariant
-- durable so a malformed legacy/admin edit can never block promotion emails.
alter table public.registrations
    drop constraint if exists registrations_contact_email_valid,
    add constraint registrations_contact_email_valid check (
        contact_email is not null
        and char_length(btrim(contact_email)) between 3 and 320
        and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    );

create or replace function private.promote_event_waitlist(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    event_record record;
    confirmed_count integer;
    waiting_registration record;
begin
    select
        events.capacity,
        events.title,
        events.starts_at,
        events.ends_at,
        events.location
    into event_record
    from public.events
    where events.id = p_event_id
    for update;

    if not found then
        raise exception 'Event could not be found.' using errcode = 'P0002';
    end if;

    select coalesce(sum(registrations.participant_count), 0)::integer
    into confirmed_count
    from public.registrations
    where registrations.event_id = p_event_id
      and registrations.status = 'confirmed';

    for waiting_registration in
        select
            registrations.id,
            registrations.participant_count,
            registrations.contact_name,
            lower(registrations.contact_email) as contact_email
        from public.registrations
        where registrations.event_id = p_event_id
          and registrations.status = 'waitlisted'
        order by registrations.created_at, registrations.id
        for update
    loop
        if confirmed_count + waiting_registration.participant_count > event_record.capacity then
            exit;
        end if;

        update public.registrations
        set status = 'confirmed'
        where id = waiting_registration.id;

        insert into public.transactional_email_deliveries (
            email_kind,
            resource_id,
            recipient,
            payload
        )
        values (
            'event_waitlist_promoted',
            waiting_registration.id,
            waiting_registration.contact_email,
            jsonb_build_object(
				'event_id', p_event_id,
                'contact_name', waiting_registration.contact_name,
                'event_title', event_record.title,
                'starts_at', event_record.starts_at,
                'ends_at', event_record.ends_at,
                'location', event_record.location,
                'participant_count', waiting_registration.participant_count
            )
        )
        on conflict (email_kind, resource_id, recipient)
        do update set
            payload = excluded.payload,
            status = case
                when transactional_email_deliveries.status = 'sent' then 'sent'
                else 'queued'
            end,
            last_error = case
                when transactional_email_deliveries.status = 'sent' then transactional_email_deliveries.last_error
                else null
            end;

        confirmed_count := confirmed_count + waiting_registration.participant_count;
    end loop;
end;
$$;

revoke all on function private.promote_event_waitlist(uuid)
from public, anon, authenticated, service_role;

create trigger events_enforce_confirmed_capacity
before update of capacity on public.events
for each row
when (new.capacity is distinct from old.capacity)
execute function private.enforce_event_capacity_floor();

create function private.promote_waitlist_after_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.deleted_at is null
       and new.published
       and new.starts_at > now()
       and (
           new.capacity > old.capacity
           or (new.registration_open and not old.registration_open)
       ) then
        perform private.promote_event_waitlist(new.id);
    end if;

    return new;
end;
$$;

revoke all on function private.promote_waitlist_after_event_change()
from public, anon, authenticated, service_role;

create trigger events_promote_waitlist_after_change
after update of capacity, registration_open on public.events
for each row
when (
    new.capacity > old.capacity
    or (new.registration_open and not old.registration_open)
)
execute function private.promote_waitlist_after_event_change();

comment on function private.enforce_event_capacity_floor() is
    'Rejects event capacity changes that would displace already-confirmed attendees.';
comment on function private.promote_waitlist_after_event_change() is
    'Promotes strictly FIFO waitlisted groups after an active event gains seats or registration reopens.';

-- QR/check-in capability. Raw bearer tokens are returned only when explicitly
-- issued and are never stored. Only their SHA-256 digests live in the private,
-- non-Data-API schema. Browser roles have no direct table access.
create table private.registration_checkins (
    registration_id uuid primary key
        references public.registrations (id) on delete cascade,
    token_digest bytea not null unique,
    issued_at timestamptz not null default now(),
    expires_at timestamptz not null,
    checked_in_at timestamptz,
    checked_in_by uuid references auth.users (id) on delete set null,
    constraint registration_checkins_expiry_valid
        check (expires_at > issued_at),
    constraint registration_checkins_audit_shape
        check (
            (checked_in_at is null and checked_in_by is null)
            or checked_in_at is not null
        )
);

alter table private.registration_checkins enable row level security;

revoke all on table private.registration_checkins
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table private.registration_checkins
to service_role;

create function private.issue_registration_checkin_token(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    caller_is_admin boolean := private.is_site_administrator(caller_id);
    registration_record record;
    raw_token text;
    token_attempt integer;
begin
    if caller_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    if p_registration_id is null then
        raise exception 'Choose a registration.' using errcode = '22023';
    end if;

    select
        registrations.account_id,
        registrations.status,
        events.ends_at,
        events.deleted_at,
        checkins.checked_in_at
    into registration_record
    from public.registrations as registrations
    join public.events as events on events.id = registrations.event_id
    left join private.registration_checkins as checkins
      on checkins.registration_id = registrations.id
    where registrations.id = p_registration_id
    for update of registrations;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;

    if registration_record.account_id is distinct from caller_id
       and not caller_is_admin then
        raise exception 'You cannot create a check-in code for this registration.'
            using errcode = '42501';
    end if;

    if registration_record.status <> 'confirmed' then
        raise exception 'Only confirmed registrations can receive a check-in code.'
            using errcode = 'P0001';
    end if;

    if registration_record.deleted_at is not null
       or registration_record.ends_at + interval '7 days' <= now() then
        raise exception 'This event is no longer available for check-in.'
            using errcode = 'P0001';
    end if;

    if registration_record.checked_in_at is not null then
        raise exception 'This registration is already checked in.'
            using errcode = 'P0001';
    end if;

    for token_attempt in 1..3 loop
        raw_token := encode(extensions.gen_random_bytes(32), 'hex');

        begin
            insert into private.registration_checkins (
                registration_id,
                token_digest,
                issued_at,
                expires_at
            )
            values (
                p_registration_id,
                extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
                now(),
                registration_record.ends_at + interval '7 days'
            )
            on conflict (registration_id)
            do update set
                token_digest = excluded.token_digest,
                issued_at = excluded.issued_at,
                expires_at = excluded.expires_at
            where private.registration_checkins.checked_in_at is null;

            if found then
                return raw_token;
            end if;

            raise exception 'This registration is already checked in.'
                using errcode = 'P0001';
        exception
            when unique_violation then
                if token_attempt = 3 then
                    raise exception 'A unique check-in code could not be created. Try again.'
                        using errcode = 'P0001';
                end if;
        end;
    end loop;

    raise exception 'A check-in code could not be created. Try again.'
        using errcode = 'P0001';
end;
$$;

create function public.issue_registration_checkin_token(p_registration_id uuid)
returns text
language sql
security definer
set search_path = ''
as $$
    select private.issue_registration_checkin_token($1);
$$;

create function private.issue_guest_registration_checkin_token(
    p_registration_id uuid,
    p_claim_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_claim_token text := lower(btrim(coalesce(p_claim_token, '')));
    claim_owner uuid;
begin
    if normalized_claim_token !~ '^[0-9a-f]{64}$' then
        raise exception 'The guest registration link is invalid or expired.'
            using errcode = 'P0002';
    end if;

    select registrations.account_id
    into claim_owner
    from public.guest_registration_claims as claims
    join public.registrations as registrations
      on registrations.id = claims.registration_id
    where claims.registration_id = p_registration_id
      and claims.claimed_at is null
      and claims.expires_at > now()
      and claims.token_hash = extensions.digest(
          pg_catalog.convert_to(normalized_claim_token, 'UTF8'),
          'sha256'
      );

    if not found
       or claim_owner is distinct from auth.uid()
       or not private.is_anonymous_user(claim_owner) then
        raise exception 'The guest registration link is invalid or expired.'
            using errcode = 'P0002';
    end if;

    return private.issue_registration_checkin_token(p_registration_id);
end;
$$;

create function public.issue_guest_registration_checkin_token(
    p_registration_id uuid,
    p_claim_token text
)
returns text
language sql
security definer
set search_path = ''
as $$
    select private.issue_guest_registration_checkin_token($1, $2);
$$;

create function private.lookup_registration_checkin(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_token text := lower(btrim(coalesce(p_token, '')));
    checkin_record jsonb;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if normalized_token !~ '^[0-9a-f]{64}$' then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    select jsonb_build_object(
        'registration_id', registrations.id,
        'event_id', events.id,
        'event_title', events.title,
		'event_deleted_at', events.deleted_at,
        'starts_at', events.starts_at,
        'ends_at', events.ends_at,
        'location', events.location,
        'registration_status', registrations.status,
        'participant_count', registrations.participant_count,
        'contact_name', registrations.contact_name,
        'contact_email', registrations.contact_email,
        'contact_phone', registrations.contact_phone,
        'checked_in_at', checkins.checked_in_at,
        'checked_in_by', checkins.checked_in_by,
        'attendees', coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'position', participants.position,
                        'full_name', participants.full_name,
                        'attendee_type', participants.attendee_type,
                        'age', participants.age,
                        'school_district', participants.school_district
                    )
                    order by participants.position
                )
                from public.registration_participants as participants
                where participants.registration_id = registrations.id
            ),
            '[]'::jsonb
        )
    )
    into checkin_record
    from private.registration_checkins as checkins
    join public.registrations as registrations
      on registrations.id = checkins.registration_id
    join public.events as events on events.id = registrations.event_id
    where checkins.token_digest = extensions.digest(
        pg_catalog.convert_to(normalized_token, 'UTF8'),
        'sha256'
    )
      and checkins.expires_at > now();

    if checkin_record is null then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    return checkin_record;
end;
$$;

create function public.lookup_registration_checkin(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select private.lookup_registration_checkin($1);
$$;

create function private.check_in_event_registration(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    normalized_token text := lower(btrim(coalesce(p_token, '')));
    target_registration_id uuid;
    target_event_id uuid;
    registration_record record;
    was_already_checked_in boolean;
    result_record jsonb;
begin
    if not private.is_site_administrator(caller_id) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if normalized_token !~ '^[0-9a-f]{64}$' then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    select checkins.registration_id
    into target_registration_id
    from private.registration_checkins as checkins
    where checkins.token_digest = extensions.digest(
        pg_catalog.convert_to(normalized_token, 'UTF8'),
        'sha256'
    )
      and checkins.expires_at > now();

    if not found then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    -- Match the event -> registration lock order used by registration edits and
    -- cancellation so status cannot change between validation and check-in.
    select events.id
    into target_event_id
    from public.events as events
    join public.registrations as registrations
      on registrations.event_id = events.id
    where registrations.id = target_registration_id
    for update of events;

    if not found then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    select
        checkins.registration_id,
        checkins.checked_in_at,
        registrations.status,
        events.deleted_at
    into registration_record
    from private.registration_checkins as checkins
    join public.registrations as registrations
      on registrations.id = checkins.registration_id
    join public.events as events on events.id = registrations.event_id
    where checkins.token_digest = extensions.digest(
        pg_catalog.convert_to(normalized_token, 'UTF8'),
        'sha256'
    )
      and checkins.expires_at > now()
      and registrations.id = target_registration_id
      and events.id = target_event_id
    for update of registrations, checkins;

    if not found then
        raise exception 'The registration QR code is invalid or expired.'
            using errcode = 'P0002';
    end if;

    if registration_record.status <> 'confirmed' then
        raise exception 'This registration is not confirmed.' using errcode = 'P0001';
    end if;

    if registration_record.deleted_at is not null then
        raise exception 'This event is archived and cannot accept check-ins.'
            using errcode = 'P0001';
    end if;

    was_already_checked_in := registration_record.checked_in_at is not null;

    if not was_already_checked_in then
        update private.registration_checkins
        set
            checked_in_at = now(),
            checked_in_by = caller_id
        where registration_id = registration_record.registration_id;
    end if;

    result_record := private.lookup_registration_checkin(normalized_token);
    return result_record || jsonb_build_object(
        'already_checked_in', was_already_checked_in
    );
end;
$$;

create function public.check_in_event_registration(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select private.check_in_event_registration($1);
$$;

create function private.check_in_registration_as_admin(p_registration_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    registration_record record;
    result_record jsonb;
begin
    if not private.is_site_administrator(caller_id) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    perform 1
    from public.events as events
    join public.registrations as registrations
      on registrations.event_id = events.id
    where registrations.id = p_registration_id
    for update of events;

    select
        registrations.id,
        registrations.status,
        events.ends_at,
        events.deleted_at,
        checkins.checked_in_at
    into registration_record
    from public.registrations as registrations
    join public.events as events on events.id = registrations.event_id
    left join private.registration_checkins as checkins
      on checkins.registration_id = registrations.id
    where registrations.id = p_registration_id
    for update of registrations;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;
    if registration_record.status <> 'confirmed' then
        raise exception 'This registration is not confirmed.' using errcode = 'P0001';
    end if;
    if registration_record.deleted_at is not null
       or registration_record.ends_at + interval '7 days' <= now() then
        raise exception 'This event is no longer available for check-in.' using errcode = 'P0001';
    end if;

    if registration_record.checked_in_at is null then
        insert into private.registration_checkins (
            registration_id,
            token_digest,
            issued_at,
            expires_at,
            checked_in_at,
            checked_in_by
        )
        values (
            p_registration_id,
            extensions.digest(extensions.gen_random_bytes(32), 'sha256'),
            now(),
            greatest(registration_record.ends_at + interval '7 days', now() + interval '1 minute'),
            now(),
            caller_id
        )
        on conflict (registration_id)
        do update set
            checked_in_at = coalesce(private.registration_checkins.checked_in_at, excluded.checked_in_at),
            checked_in_by = coalesce(private.registration_checkins.checked_in_by, excluded.checked_in_by);
    end if;

    select jsonb_build_object(
        'registration_id', registrations.id,
        'event_id', events.id,
        'event_title', events.title,
        'starts_at', events.starts_at,
        'ends_at', events.ends_at,
        'location', events.location,
        'event_deleted_at', events.deleted_at,
        'registration_status', registrations.status,
        'participant_count', registrations.participant_count,
        'contact_name', registrations.contact_name,
        'checked_in_at', checkins.checked_in_at,
        'checked_in_by', checkins.checked_in_by,
        'already_checked_in', registration_record.checked_in_at is not null
    )
    into result_record
    from public.registrations as registrations
    join public.events as events on events.id = registrations.event_id
    join private.registration_checkins as checkins
      on checkins.registration_id = registrations.id
    where registrations.id = p_registration_id;

    return result_record;
end;
$$;

create function public.check_in_registration_as_admin(p_registration_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
    select private.check_in_registration_as_admin($1);
$$;

revoke all on function private.issue_registration_checkin_token(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.lookup_registration_checkin(text)
from public, anon, authenticated, service_role;
revoke all on function private.check_in_event_registration(text)
from public, anon, authenticated, service_role;
revoke all on function private.issue_guest_registration_checkin_token(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function private.check_in_registration_as_admin(uuid)
from public, anon, authenticated, service_role;

revoke all on function public.issue_registration_checkin_token(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.lookup_registration_checkin(text)
from public, anon, authenticated, service_role;
revoke all on function public.check_in_event_registration(text)
from public, anon, authenticated, service_role;
revoke all on function public.issue_guest_registration_checkin_token(uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.check_in_registration_as_admin(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.issue_registration_checkin_token(uuid)
to authenticated;
grant execute on function public.lookup_registration_checkin(text)
to authenticated;
grant execute on function public.check_in_event_registration(text)
to authenticated;
grant execute on function public.issue_guest_registration_checkin_token(uuid, text)
to authenticated;
grant execute on function public.check_in_registration_as_admin(uuid)
to authenticated;

comment on table private.registration_checkins is
    'Private digests and audit state for one-time per-registration QR check-in codes.';
comment on function public.issue_registration_checkin_token(uuid) is
    'Creates or rotates an unguessable check-in token for an owned confirmed registration; the raw token is returned once and never stored.';
comment on function public.lookup_registration_checkin(text) is
    'Administrator-only lookup of a registration QR token without changing check-in state.';
comment on function public.check_in_event_registration(text) is
    'Administrator-only idempotent check-in of a confirmed registration QR token.';
comment on function public.issue_guest_registration_checkin_token(uuid, text) is
    'Issues a check-in token to the still-authenticated anonymous owner using its unexpired guest claim secret.';
comment on function public.check_in_registration_as_admin(uuid) is
    'Administrator-only manual check-in fallback for confirmed household or guest registrations.';

-- Give each delivery an atomic processing lease. The retry window is shorter
-- than Resend's 24-hour idempotency window so an uncertain delivery is never
-- automatically resent after the provider can no longer deduplicate it.
alter table public.transactional_email_deliveries
    add column processing_started_at timestamptz,
    add column processing_token uuid,
    add column retry_not_after timestamptz;

update public.transactional_email_deliveries
set
    processing_started_at = now(),
    processing_token = extensions.gen_random_uuid(),
    retry_not_after = now() + interval '23 hours'
where status = 'processing';

alter table public.transactional_email_deliveries
    add constraint transactional_email_processing_shape check (
        (
            status = 'processing'
            and processing_started_at is not null
            and processing_token is not null
            and retry_not_after is not null
        )
        or (
            status <> 'processing'
            and processing_token is null
        )
    );

create function private.protect_processing_email_delivery()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    -- Existing queue RPCs use an UPSERT. If another request queues the same
    -- message while a worker owns it, keep that worker's immutable snapshot and
    -- lease instead of making the delivery claimable a second time.
    if old.status = 'processing' and new.status = 'queued' then
        new.status := old.status;
        new.payload := old.payload;
        new.last_error := old.last_error;
        new.processing_started_at := old.processing_started_at;
        new.processing_token := old.processing_token;
        new.retry_not_after := old.retry_not_after;
    end if;

    -- Keep this migration compatible with the worker that is live during the
    -- rollout. Its legacy processing transition does not populate leases, so
    -- add one here until the atomic worker has been deployed. Clear lease state
    -- whenever either worker reaches a non-processing state.
    if new.status = 'processing' then
        new.processing_started_at := coalesce(new.processing_started_at, now());
        new.processing_token := coalesce(new.processing_token, extensions.gen_random_uuid());
        new.retry_not_after := coalesce(new.retry_not_after, now() + interval '23 hours');
    else
        new.processing_started_at := null;
        new.processing_token := null;
        if new.status = 'sent' then
            new.retry_not_after := null;
        end if;
    end if;

    return new;
end;
$$;

revoke all on function private.protect_processing_email_delivery()
from public, anon, authenticated, service_role;

create trigger transactional_email_protect_processing
before update on public.transactional_email_deliveries
for each row
execute function private.protect_processing_email_delivery();

create function public.claim_transactional_email_delivery(p_delivery_id uuid)
returns table (
    id uuid,
    email_kind text,
    resource_id uuid,
    recipient text,
    payload jsonb,
    status text,
    attempts integer,
    processing_token uuid
)
language sql
security definer
set search_path = ''
as $$
    update public.transactional_email_deliveries as deliveries
    set
        status = 'processing',
        attempts = deliveries.attempts + 1,
        processing_started_at = now(),
        processing_token = extensions.gen_random_uuid(),
        retry_not_after = coalesce(
            deliveries.retry_not_after,
            now() + interval '23 hours'
        ),
        last_error = null
    where deliveries.id = p_delivery_id
      and deliveries.attempts < 5
      and (
          deliveries.retry_not_after is null
          or deliveries.retry_not_after > now()
      )
      and (
          deliveries.status in ('queued', 'failed')
          or (
              deliveries.status = 'processing'
              and deliveries.processing_started_at < now() - interval '10 minutes'
          )
      )
    returning
        deliveries.id,
        deliveries.email_kind,
        deliveries.resource_id,
        deliveries.recipient,
        deliveries.payload,
        deliveries.status,
        deliveries.attempts,
        deliveries.processing_token;
$$;

create function public.complete_transactional_email_delivery(
    p_delivery_id uuid,
    p_processing_token uuid,
    p_provider_message_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
    with updated as (
        update public.transactional_email_deliveries as deliveries
        set
            status = 'sent',
            provider_message_id = nullif(btrim(p_provider_message_id), ''),
            sent_at = now(),
            last_error = null,
            processing_started_at = null,
            processing_token = null,
            retry_not_after = null
        where deliveries.id = p_delivery_id
          and deliveries.status = 'processing'
          and deliveries.processing_token = p_processing_token
        returning 1
    )
    select exists(select 1 from updated);
$$;

create function public.fail_transactional_email_delivery(
    p_delivery_id uuid,
    p_processing_token uuid,
    p_error text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
    with updated as (
        update public.transactional_email_deliveries as deliveries
        set
            status = 'failed',
            last_error = left(
                coalesce(nullif(btrim(p_error), ''), 'Email delivery failed.'),
                2000
            ),
            processing_started_at = null,
            processing_token = null
        where deliveries.id = p_delivery_id
          and deliveries.status = 'processing'
          and deliveries.processing_token = p_processing_token
        returning 1
    )
    select exists(select 1 from updated);
$$;

create function public.list_claimable_transactional_email_deliveries(
    p_email_kind text default null,
    p_limit integer default 25
)
returns table (id uuid)
language sql
security definer
set search_path = ''
as $$
    select deliveries.id
    from public.transactional_email_deliveries as deliveries
    where deliveries.attempts < 5
      and (
          deliveries.retry_not_after is null
          or deliveries.retry_not_after > now()
      )
      and (
          deliveries.status in ('queued', 'failed')
          or (
              deliveries.status = 'processing'
              and deliveries.processing_started_at < now() - interval '10 minutes'
          )
      )
      and (p_email_kind is null or deliveries.email_kind = p_email_kind)
    order by deliveries.created_at, deliveries.id
    limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

-- A household may prompt only the first delivery attempt for promotions on an
-- event it just changed. Failed retries remain administrator-only so an
-- unprivileged caller cannot consume the retry budget for other families.
-- Existing queued promotion rows predate the event_id payload; fall back to
-- their registration join so they remain dispatchable after this rollout.
create function public.list_initial_event_promotion_deliveries(
    p_event_id uuid,
    p_limit integer default 25
)
returns table (id uuid)
language sql
security definer
set search_path = ''
as $$
    select deliveries.id
    from public.transactional_email_deliveries as deliveries
    where deliveries.email_kind = 'event_waitlist_promoted'
      and deliveries.status = 'queued'
      and deliveries.attempts = 0
      and (
          deliveries.payload ->> 'event_id' = p_event_id::text
          or exists (
              select 1
              from public.registrations
              where registrations.id = deliveries.resource_id
                and registrations.event_id = p_event_id
          )
      )
    order by deliveries.created_at, deliveries.id
    limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

revoke all on function public.claim_transactional_email_delivery(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.complete_transactional_email_delivery(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.fail_transactional_email_delivery(uuid, uuid, text)
from public, anon, authenticated, service_role;
revoke all on function public.list_claimable_transactional_email_deliveries(text, integer)
from public, anon, authenticated, service_role;
revoke all on function public.list_initial_event_promotion_deliveries(uuid, integer)
from public, anon, authenticated, service_role;

grant execute on function public.claim_transactional_email_delivery(uuid)
to service_role;
grant execute on function public.complete_transactional_email_delivery(uuid, uuid, text)
to service_role;
grant execute on function public.fail_transactional_email_delivery(uuid, uuid, text)
to service_role;
grant execute on function public.list_claimable_transactional_email_deliveries(text, integer)
to service_role;
grant execute on function public.list_initial_event_promotion_deliveries(uuid, integer)
to service_role;

comment on function public.claim_transactional_email_delivery(uuid) is
    'Service-role-only atomic delivery claim with a bounded retry lease.';
comment on function public.complete_transactional_email_delivery(uuid, uuid, text) is
    'Service-role-only compare-and-set transition from processing to sent.';
comment on function public.fail_transactional_email_delivery(uuid, uuid, text) is
    'Service-role-only compare-and-set transition from processing to failed.';
comment on function public.list_claimable_transactional_email_deliveries(text, integer) is
    'Service-role-only ordered list of deliveries that remain eligible for an atomic claim.';
comment on function public.list_initial_event_promotion_deliveries(uuid, integer) is
    'Service-role-only list of first-attempt waitlist promotion deliveries for one event.';
