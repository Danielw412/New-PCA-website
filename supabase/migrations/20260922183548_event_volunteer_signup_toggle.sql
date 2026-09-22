-- Let administrators end volunteer sign-ups for one event without closing
-- attendee registration. The volunteer request RPC enforces the flag, and
-- event_catalog exposes it so public listings can drop the Volunteer button.
-- Requests that already exist are untouched and stay reviewable.

alter table public.events
    add column volunteer_signups_open boolean not null default true;

comment on column public.events.volunteer_signups_open is
    'When false, new event volunteer requests are rejected. Existing requests keep their status.';

-- Existing columns keep their order; the new ones are appended.
create or replace view public.event_catalog
with (security_invoker = true, security_barrier = true)
as
select
    events.id,
    events.title,
    events.description,
    events.location,
    events.starts_at,
    events.ends_at,
    events.capacity,
    events.max_participants_per_registration,
    events.registration_open,
    events.published,
    events.created_at,
    events.updated_at,
    case
        when events.starts_at is null
             and events.ends_at is null
             and events.event_date <= (now() at time zone 'America/New_York')::date then 'past'
        when events.ends_at < now() then 'past'
        when events.starts_at <= now() then 'in_progress'
        else 'upcoming'
    end as lifecycle,
    (
        events.published
        and events.registration_open
        and events.starts_at is not null
        and events.starts_at > now()
    ) as registration_available,
    events.event_date,
    events.volunteer_signups_open,
    (
        events.published
        and events.volunteer_signups_open
        and events.starts_at is not null
        and events.starts_at > now()
    ) as volunteer_signups_available
from public.events
where events.deleted_at is null;

comment on view public.event_catalog is
    'RLS-aware event discovery view whose lifecycle changes automatically from upcoming to past after ends_at or event_date.';

-- The browser only reads this view; drop the platform-default extras.
revoke all on public.event_catalog from public, anon, authenticated;
grant select on public.event_catalog to anon, authenticated;

create or replace function private.submit_event_volunteer_request(
    p_event_id uuid,
    p_request jsonb
)
returns table (request_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    normalized_name text := btrim(coalesce(p_request ->> 'full_name', ''));
    normalized_email text := lower(btrim(coalesce(p_request ->> 'email', '')));
    normalized_phone text := nullif(btrim(coalesce(p_request ->> 'phone', '')), '');
    normalized_school text := nullif(btrim(coalesce(p_request ->> 'school_name', '')), '');
    normalized_interests text := btrim(coalesce(p_request ->> 'interests', ''));
    normalized_availability text := btrim(coalesce(p_request ->> 'availability', ''));
    requested_age smallint;
    wants_updates boolean := coalesce((p_request ->> 'future_event_emails')::boolean, true);
    signups_open boolean;
    matched_account_id uuid;
    saved_request_id uuid;
begin
    if caller_id is null then
        raise exception 'Start a guest session or sign in before volunteering.' using errcode = '42501';
    end if;

    begin
        requested_age := (p_request ->> 'age')::smallint;
    exception when others then
        raise exception 'Enter a valid age.' using errcode = '22023';
    end;

    if char_length(normalized_name) not between 1 and 120 then
        raise exception 'Enter your full name.' using errcode = '22023';
    end if;

    if char_length(normalized_email) not between 3 and 320
       or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
        raise exception 'Enter a valid email address.' using errcode = '22023';
    end if;

    if requested_age not between 0 and 100 then
        raise exception 'Enter an age from 0 to 100.' using errcode = '22023';
    end if;

    if normalized_phone is not null and char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Phone numbers must be between 7 and 40 characters.' using errcode = '22023';
    end if;

    if normalized_school is not null and char_length(normalized_school) > 200 then
        raise exception 'School or organization names must be 200 characters or fewer.' using errcode = '22023';
    end if;

    if char_length(normalized_interests) > 2000 or char_length(normalized_availability) > 2000 then
        raise exception 'Volunteer details must be 2,000 characters or fewer.' using errcode = '22023';
    end if;

    -- FOR SHARE waits for an in-flight "end sign-ups" update and then reads
    -- the committed flag, so no request is accepted after sign-ups end.
    select events.volunteer_signups_open
    into signups_open
    from public.events
    where id = p_event_id
      and published = true
      and deleted_at is null
      and starts_at > now()
    for share;

    if not found then
        raise exception 'This event is not accepting volunteer requests.' using errcode = 'P0002';
    end if;

    if not signups_open then
        raise exception 'Volunteer sign-ups for this event have ended.' using errcode = 'P0001';
    end if;

    select profiles.id
    into matched_account_id
    from public.profiles
    where profiles.id = caller_id;

    insert into public.event_volunteer_requests (
        event_id,
        requester_user_id,
        linked_account_id,
        full_name,
        email,
        age,
        phone,
        school_name,
        interests,
        availability,
        future_event_emails
    )
    values (
        p_event_id,
        caller_id,
        matched_account_id,
        normalized_name,
        normalized_email,
        requested_age,
        normalized_phone,
        normalized_school,
        normalized_interests,
        normalized_availability,
        wants_updates
    )
    returning id into saved_request_id;

    return query select saved_request_id, 'pending'::text;
exception
    when unique_violation then
        raise exception 'A volunteer request for this email and event is already pending or approved.'
            using errcode = '23505';
end;
$$;

create function private.set_event_volunteer_signups(
    p_event_id uuid,
    p_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    saved_state boolean;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if p_open is null then
        raise exception 'Choose whether volunteer sign-ups are open.' using errcode = '22023';
    end if;

    update public.events
    set volunteer_signups_open = p_open
    where id = p_event_id
      and deleted_at is null
    returning volunteer_signups_open into saved_state;

    if not found then
        raise exception 'The event could not be found or was deleted.' using errcode = 'P0002';
    end if;

    return saved_state;
end;
$$;

create function public.set_event_volunteer_signups(
    p_event_id uuid,
    p_open boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    select private.set_event_volunteer_signups($1, $2);
$$;

comment on function public.set_event_volunteer_signups(uuid, boolean) is
    'Administrator-only switch that ends or reopens new volunteer requests for one event.';

revoke all on function private.set_event_volunteer_signups(uuid, boolean)
from public, anon, service_role;
grant execute on function private.set_event_volunteer_signups(uuid, boolean) to authenticated;

revoke all on function public.set_event_volunteer_signups(uuid, boolean) from public, anon;
grant execute on function public.set_event_volunteer_signups(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
