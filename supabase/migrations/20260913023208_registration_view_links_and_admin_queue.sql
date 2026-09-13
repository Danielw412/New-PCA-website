-- Registration view links, guest self-lookup, richer confirmation payloads,
-- and administrator visibility into the transactional email outbox.
--
-- 1. Confirmation and waitlist-promotion emails carry a capability link that
--    opens registration.html. Only SHA-256 digests of the link tokens are
--    stored, in the private schema, outside the Data API.
-- 2. Registrants (including anonymous guests) can ask for their own link and
--    look up their own registration for an event, so a returning guest is told
--    they already registered instead of failing at the end of the form.
-- 3. Administrators can read outbox counts, which the dashboard uses to show
--    whether email delivery is configured and healthy.

-- 1. Private link tokens -----------------------------------------------------

create table private.registration_view_tokens (
    id uuid primary key default gen_random_uuid(),
    registration_id uuid not null references public.registrations (id) on delete cascade,
    token_hash bytea not null unique,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    constraint registration_view_tokens_expiry_valid check (expires_at > created_at)
);

create index registration_view_tokens_registration_id_idx
    on private.registration_view_tokens (registration_id);

alter table private.registration_view_tokens enable row level security;

revoke all on table private.registration_view_tokens
from public, anon, authenticated, service_role;

comment on table private.registration_view_tokens is
    'SHA-256 digests of registration view links. Raw tokens exist only in email payloads and the registrant''s browser.';

create function private.issue_registration_view_token(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    raw_token text;
    event_end timestamptz;
begin
    select coalesce(events.ends_at, events.starts_at, now())
    into event_end
    from public.registrations
    join public.events on events.id = registrations.event_id
    where registrations.id = p_registration_id;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;

    raw_token := encode(extensions.gen_random_bytes(32), 'hex');

    insert into private.registration_view_tokens (registration_id, token_hash, expires_at)
    values (
        p_registration_id,
        extensions.digest(pg_catalog.convert_to(raw_token, 'UTF8'), 'sha256'),
        greatest(event_end, now()) + interval '90 days'
    );

    -- Keep at most ten live links per registration so repeated requests
    -- cannot grow the table without bound. Expired links go too.
    delete from private.registration_view_tokens as tokens
    where tokens.registration_id = p_registration_id
      and (
          tokens.expires_at <= now()
          or tokens.id in (
              select newer.id
              from private.registration_view_tokens as newer
              where newer.registration_id = p_registration_id
              order by newer.created_at desc, newer.id desc
              offset 10
          )
      );

    return raw_token;
end;
$$;

revoke all on function private.issue_registration_view_token(uuid)
from public, anon, authenticated, service_role;

create function public.issue_registration_view_token(p_registration_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    owner_id uuid;
begin
    if caller_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    select registrations.account_id
    into owner_id
    from public.registrations
    where registrations.id = p_registration_id;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;

    if owner_id is distinct from caller_id and not private.is_site_administrator(caller_id) then
        raise exception 'You cannot create a link for this registration.' using errcode = '42501';
    end if;

    return private.issue_registration_view_token(p_registration_id);
end;
$$;

revoke all on function public.issue_registration_view_token(uuid)
from public, anon, service_role;
grant execute on function public.issue_registration_view_token(uuid) to authenticated;

comment on function public.issue_registration_view_token(uuid) is
    'Creates a view link token for a registration the caller owns or administers. The raw token is returned once.';

create function public.get_registration_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    normalized_token text := lower(btrim(coalesce(p_token, '')));
    result jsonb;
begin
    if normalized_token !~ '^[0-9a-f]{64}$' then
        raise exception 'This registration link is invalid or has expired.' using errcode = 'P0002';
    end if;

    select jsonb_build_object(
        'registration_id', registrations.id,
        'status', registrations.status,
        'participant_count', registrations.participant_count,
        'registration_source', registrations.registration_source,
        'contact_name', registrations.contact_name,
        'contact_email', registrations.contact_email,
        'contact_phone', registrations.contact_phone,
        'created_at', registrations.created_at,
        'updated_at', registrations.updated_at,
        'cancelled_at', registrations.cancelled_at,
        'owner_is_permanent', private.is_permanent_user(registrations.account_id),
        'event', jsonb_build_object(
            'id', events.id,
            'title', events.title,
            'description', events.description,
            'location', events.location,
            'starts_at', events.starts_at,
            'ends_at', events.ends_at,
            'event_date', events.event_date,
            'deleted', events.deleted_at is not null
        ),
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
    into result
    from private.registration_view_tokens as tokens
    join public.registrations on registrations.id = tokens.registration_id
    join public.events on events.id = registrations.event_id
    where tokens.token_hash = extensions.digest(pg_catalog.convert_to(normalized_token, 'UTF8'), 'sha256')
      and tokens.expires_at > now();

    if result is null then
        raise exception 'This registration link is invalid or has expired.' using errcode = 'P0002';
    end if;

    return result;
end;
$$;

revoke all on function public.get_registration_by_token(text)
from public, service_role;
grant execute on function public.get_registration_by_token(text) to anon, authenticated;

comment on function public.get_registration_by_token(text) is
    'Returns one registration, its event, and its attendees for an unexpired view link token.';

-- 2. Own-registration lookup (works for anonymous guests) --------------------

create function public.get_my_event_registration(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'registration_id', registrations.id,
        'status', registrations.status,
        'participant_count', registrations.participant_count,
        'contact_email', registrations.contact_email,
        'created_at', registrations.created_at,
        'attendee_names', coalesce(
            (
                select jsonb_agg(participants.full_name order by participants.position)
                from public.registration_participants as participants
                where participants.registration_id = registrations.id
            ),
            '[]'::jsonb
        )
    )
    from public.registrations
    where registrations.event_id = p_event_id
      and registrations.account_id = (select auth.uid())
      and registrations.status <> 'cancelled'
    order by registrations.created_at desc
    limit 1;
$$;

revoke all on function public.get_my_event_registration(uuid)
from public, anon, service_role;
grant execute on function public.get_my_event_registration(uuid) to authenticated;

comment on function public.get_my_event_registration(uuid) is
    'The caller''s active registration for one event, or null. Anonymous guests can call it for their own session.';

-- 3. Richer confirmation payloads ---------------------------------------------

create or replace function private.queue_transactional_email(
    p_email_kind text,
    p_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    caller_is_admin boolean := private.is_site_administrator(caller_id);
    destination text;
    message_payload jsonb;
    delivery_id uuid;
    registration_record record;
    request_record record;
    application_record record;
begin
    if caller_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    case p_email_kind
        when 'event_registration_confirmation' then
            select
                registrations.account_id,
                registrations.event_id,
                registrations.contact_name,
                lower(registrations.contact_email) as contact_email,
                registrations.status,
                registrations.participant_count,
                events.title as event_title,
                events.starts_at,
                events.ends_at,
                events.location
            into registration_record
            from public.registrations
            join public.events on events.id = registrations.event_id
            where registrations.id = p_resource_id;

            if not found then
                raise exception 'Registration could not be found.' using errcode = 'P0002';
            end if;

            if registration_record.account_id is distinct from caller_id and not caller_is_admin then
                raise exception 'You cannot send this confirmation.' using errcode = '42501';
            end if;

            destination := registration_record.contact_email;
            message_payload := jsonb_build_object(
                'event_id', registration_record.event_id,
                'contact_name', registration_record.contact_name,
                'event_title', registration_record.event_title,
                'starts_at', registration_record.starts_at,
                'ends_at', registration_record.ends_at,
                'location', registration_record.location,
                'status', registration_record.status,
                'participant_count', registration_record.participant_count,
                'attendees', coalesce(
                    (
                        select jsonb_agg(
                            jsonb_build_object(
                                'full_name', participants.full_name,
                                'attendee_type', participants.attendee_type
                            )
                            order by participants.position
                        )
                        from public.registration_participants as participants
                        where participants.registration_id = p_resource_id
                    ),
                    '[]'::jsonb
                ),
                'view_token', private.issue_registration_view_token(p_resource_id)
            );

        when 'volunteer_request_received' then
            select
                requests.requester_user_id,
                requests.full_name,
                requests.email,
                requests.age,
                requests.phone,
                requests.school_name,
                requests.interests,
                requests.availability,
                events.title as event_title,
                events.starts_at,
                events.location
            into request_record
            from public.event_volunteer_requests as requests
            join public.events on events.id = requests.event_id
            where requests.id = p_resource_id;

            if not found then
                raise exception 'Volunteer request could not be found.' using errcode = 'P0002';
            end if;

            if request_record.requester_user_id is distinct from caller_id and not caller_is_admin then
                raise exception 'You cannot send this notification.' using errcode = '42501';
            end if;

            destination := 'pcayouthcenter@gmail.com';
            message_payload := jsonb_build_object(
                'full_name', request_record.full_name,
                'email', request_record.email,
                'age', request_record.age,
                'phone', request_record.phone,
                'school_name', request_record.school_name,
                'interests', request_record.interests,
                'availability', request_record.availability,
                'event_title', request_record.event_title,
                'starts_at', request_record.starts_at,
                'location', request_record.location
            );

        when 'volunteer_request_approved' then
            if not caller_is_admin then
                raise exception 'Administrator access is required.' using errcode = '42501';
            end if;

            select
                requests.full_name,
                lower(requests.email) as email,
                requests.status,
                requests.admin_notes,
                events.title as event_title,
                events.starts_at,
                events.location
            into request_record
            from public.event_volunteer_requests as requests
            join public.events on events.id = requests.event_id
            where requests.id = p_resource_id;

            if not found or request_record.status <> 'approved' then
                raise exception 'An approved volunteer request could not be found.' using errcode = 'P0002';
            end if;

            destination := request_record.email;
            message_payload := jsonb_build_object(
                'full_name', request_record.full_name,
                'event_title', request_record.event_title,
                'starts_at', request_record.starts_at,
                'location', request_record.location,
                'admin_notes', request_record.admin_notes
            );

        when 'volunteer_account_approved' then
            if not caller_is_admin then
                raise exception 'Administrator access is required.' using errcode = '42501';
            end if;

            select
                applications.status,
                applications.admin_notes,
                profiles.full_name,
                lower(profiles.email) as email
            into application_record
            from public.volunteer_applications as applications
            join public.profiles on profiles.id = applications.user_id
            where applications.id = p_resource_id;

            if not found or application_record.status <> 'approved' then
                raise exception 'An approved volunteer account application could not be found.' using errcode = 'P0002';
            end if;

            destination := application_record.email;
            message_payload := jsonb_build_object(
                'full_name', application_record.full_name,
                'admin_notes', application_record.admin_notes
            );

        else
            raise exception 'Unsupported email template.' using errcode = '22023';
    end case;

    if destination is null then
        raise exception 'The email recipient is missing.' using errcode = '22023';
    end if;

    insert into public.transactional_email_deliveries (
        email_kind,
        resource_id,
        recipient,
        payload
    )
    values (
        p_email_kind,
        p_resource_id,
        lower(destination),
        message_payload
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
        end
    returning id into delivery_id;

    return delivery_id;
end;
$$;

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
                'participant_count', waiting_registration.participant_count,
                'view_token', private.issue_registration_view_token(waiting_registration.id)
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

-- 4. Administrator outbox summary -------------------------------------------

create function public.admin_email_queue_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    summary jsonb;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    select jsonb_build_object(
        'queued', count(*) filter (where deliveries.status = 'queued'),
        'processing', count(*) filter (where deliveries.status = 'processing'),
        'failed', count(*) filter (where deliveries.status = 'failed'),
        'sent', count(*) filter (where deliveries.status = 'sent'),
        'exhausted', count(*) filter (where deliveries.status <> 'sent' and deliveries.attempts >= 5),
        'oldest_pending_at', min(deliveries.created_at) filter (where deliveries.status in ('queued', 'failed')),
        'last_sent_at', max(deliveries.sent_at),
        'last_error', (
            select failed.last_error
            from public.transactional_email_deliveries as failed
            where failed.status = 'failed'
            order by failed.updated_at desc
            limit 1
        )
    )
    into summary
    from public.transactional_email_deliveries as deliveries;

    return summary;
end;
$$;

revoke all on function public.admin_email_queue_summary()
from public, anon, service_role;
grant execute on function public.admin_email_queue_summary() to authenticated;

comment on function public.admin_email_queue_summary() is
    'Administrator-only counts of the transactional email outbox by status.';
