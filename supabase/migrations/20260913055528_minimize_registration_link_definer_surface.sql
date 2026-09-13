-- Keep the exposed API surface SECURITY INVOKER, matching the rest of the
-- platform: the public functions added on 2026-09-13 become thin invoker
-- wrappers over private SECURITY DEFINER implementations, so the security
-- advisor no longer reports definer functions that browser roles can run.

create function private.get_registration_by_token(p_token text)
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

create or replace function public.get_registration_by_token(p_token text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select private.get_registration_by_token($1);
$$;

revoke all on function private.get_registration_by_token(text)
from public, service_role;
grant execute on function private.get_registration_by_token(text) to anon, authenticated;

create function private.issue_own_registration_view_token(p_registration_id uuid)
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

create or replace function public.issue_registration_view_token(p_registration_id uuid)
returns text
language sql
security invoker
set search_path = ''
as $$
    select private.issue_own_registration_view_token($1);
$$;

revoke all on function private.issue_own_registration_view_token(uuid)
from public, anon, service_role;
grant execute on function private.issue_own_registration_view_token(uuid) to authenticated;

create function private.get_my_event_registration(p_event_id uuid)
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

create or replace function public.get_my_event_registration(p_event_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select private.get_my_event_registration($1);
$$;

revoke all on function private.get_my_event_registration(uuid)
from public, anon, service_role;
grant execute on function private.get_my_event_registration(uuid) to authenticated;

create function private.admin_email_queue_summary()
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

create or replace function public.admin_email_queue_summary()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
    select private.admin_email_queue_summary();
$$;

revoke all on function private.admin_email_queue_summary()
from public, anon, service_role;
grant execute on function private.admin_email_queue_summary() to authenticated;
