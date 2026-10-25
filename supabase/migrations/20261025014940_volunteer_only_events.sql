-- Let administrators mark an event as volunteer-only: volunteers can still
-- sign up, but households and guests cannot register to attend. The flag
-- keeps registration_open false through a check constraint, so every
-- registration RPC, which already refuses closed events under a row lock,
-- turns new households away without changing. Registrations made before an
-- event became volunteer-only are kept and stay editable.

alter table public.events
    add column volunteer_only boolean not null default false;

comment on column public.events.volunteer_only is
    'When true, the event takes volunteers only and household registration stays closed. Existing registrations are kept.';

alter table public.events
    add constraint events_volunteer_only_closes_registration
    check (not (volunteer_only and registration_open));

-- Existing columns keep their order; the new one is appended.
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
    ) as volunteer_signups_available,
    events.volunteer_only
from public.events
where events.deleted_at is null;

comment on view public.event_catalog is
    'RLS-aware event discovery view whose lifecycle changes automatically from upcoming to past after ends_at or event_date.';

-- The browser only reads this view; drop the platform-default extras.
revoke all on public.event_catalog from public, anon, authenticated;
grant select on public.event_catalog to anon, authenticated;

-- save_event keeps the stored flag when the payload has no volunteer_only key,
-- so an older cached admin page cannot turn a volunteer-only event back into
-- a registration event. Opening registration on a volunteer-only event is
-- refused with a readable message instead of a constraint error.
create or replace function private.save_event(
    p_event_id uuid,
    p_event jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    saved_event_id uuid;
    event_title text := btrim(coalesce(p_event ->> 'title', ''));
    event_description text := coalesce(p_event ->> 'description', '');
    event_location text := nullif(btrim(coalesce(p_event ->> 'location', '')), '');
    event_calendar_date date;
    event_starts_at timestamptz;
    event_ends_at timestamptz;
    event_capacity integer;
    event_group_limit integer;
    event_registration_open boolean;
    event_published boolean;
    event_volunteer_questions jsonb;
    event_volunteer_only boolean;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    begin
        event_calendar_date := nullif(p_event ->> 'event_date', '')::date;
        event_starts_at := nullif(p_event ->> 'starts_at', '')::timestamptz;
        event_ends_at := nullif(p_event ->> 'ends_at', '')::timestamptz;
        event_capacity := (p_event ->> 'capacity')::integer;
        event_group_limit := (p_event ->> 'max_participants_per_registration')::integer;
        event_registration_open := coalesce((p_event ->> 'registration_open')::boolean, true);
        event_published := coalesce((p_event ->> 'published')::boolean, false);
        event_volunteer_only := (p_event ->> 'volunteer_only')::boolean;
    exception when others then
        raise exception 'Event date, times, capacity, or publication settings are invalid.' using errcode = '22023';
    end;

    if p_event ? 'volunteer_questions' then
        event_volunteer_questions := private.normalize_event_volunteer_questions(p_event -> 'volunteer_questions');
    end if;

    if event_calendar_date is null and event_starts_at is not null then
        event_calendar_date := (event_starts_at at time zone 'America/New_York')::date;
    end if;

    if char_length(event_title) not between 1 and 160
       or char_length(event_description) > 5000
       or (
           event_location is not null
           and char_length(event_location) not between 1 and 240
       )
       or event_calendar_date is null
       or ((event_starts_at is null) <> (event_ends_at is null))
       or (
           event_starts_at is not null
           and event_ends_at is not null
           and event_ends_at <= event_starts_at
       )
       or event_capacity is null
       or event_capacity < 1
       or event_group_limit is null
       or event_group_limit < 1
       or event_group_limit > event_capacity then
        raise exception 'Complete all event fields with valid values.' using errcode = '22023';
    end if;

    if event_volunteer_only is null then
        if p_event_id is null then
            event_volunteer_only := false;
        else
            select events.volunteer_only
            into event_volunteer_only
            from public.events
            where events.id = p_event_id
            for update;

            if not found then
                raise exception 'Event could not be found.' using errcode = 'P0002';
            end if;
        end if;
    end if;

    if event_volunteer_only and event_registration_open then
        raise exception 'Volunteer-only events have no household registration. Turn off volunteer-only before opening registration.'
            using errcode = '22023';
    end if;

    if p_event_id is null then
        insert into public.events (
            title,
            description,
            location,
            event_date,
            starts_at,
            ends_at,
            capacity,
            max_participants_per_registration,
            registration_open,
            published,
            volunteer_questions,
            volunteer_only
        )
        values (
            event_title,
            event_description,
            event_location,
            event_calendar_date,
            event_starts_at,
            event_ends_at,
            event_capacity,
            event_group_limit,
            event_registration_open,
            event_published,
            coalesce(event_volunteer_questions, '[]'::jsonb),
            event_volunteer_only
        )
        returning id into saved_event_id;
    else
        update public.events
        set
            title = event_title,
            description = event_description,
            location = event_location,
            event_date = event_calendar_date,
            starts_at = event_starts_at,
            ends_at = event_ends_at,
            capacity = event_capacity,
            max_participants_per_registration = event_group_limit,
            registration_open = event_registration_open,
            published = event_published,
            volunteer_questions = coalesce(event_volunteer_questions, events.volunteer_questions),
            volunteer_only = event_volunteer_only
        where id = p_event_id
        returning id into saved_event_id;

        if saved_event_id is null then
            raise exception 'Event could not be found.' using errcode = 'P0002';
        end if;
    end if;

    return saved_event_id;
end;
$$;

-- Same switch as before, plus a readable refusal for volunteer-only events.
create or replace function private.set_event_registration_open(
    p_event_id uuid,
    p_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    event_starts_at timestamptz;
    event_volunteer_only boolean;
    saved_state boolean;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if p_open is null then
        raise exception 'Choose whether registration is open.' using errcode = '22023';
    end if;

    select events.starts_at, events.volunteer_only
    into event_starts_at, event_volunteer_only
    from public.events
    where id = p_event_id
      and deleted_at is null
    for update;

    if not found then
        raise exception 'The event could not be found or was deleted.' using errcode = 'P0002';
    end if;

    if p_open and event_volunteer_only then
        raise exception 'This is a volunteer-only event. Turn off volunteer-only before opening registration.' using errcode = '22023';
    end if;

    if p_open and event_starts_at is null then
        raise exception 'Add a start time before opening registration.' using errcode = '22023';
    end if;

    update public.events
    set registration_open = p_open
    where id = p_event_id
    returning registration_open into saved_state;

    return saved_state;
end;
$$;

-- Turning volunteer-only on also closes household registration in the same
-- update. Turning it off leaves registration closed until an administrator
-- reopens it, so no household can register by surprise.
create function private.set_event_volunteer_only(
    p_event_id uuid,
    p_volunteer_only boolean
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

    if p_volunteer_only is null then
        raise exception 'Choose whether the event is volunteer-only.' using errcode = '22023';
    end if;

    update public.events
    set
        volunteer_only = p_volunteer_only,
        registration_open = case when p_volunteer_only then false else events.registration_open end
    where id = p_event_id
      and deleted_at is null
    returning volunteer_only into saved_state;

    if not found then
        raise exception 'The event could not be found or was deleted.' using errcode = 'P0002';
    end if;

    return saved_state;
end;
$$;

create function public.set_event_volunteer_only(
    p_event_id uuid,
    p_volunteer_only boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    select private.set_event_volunteer_only($1, $2);
$$;

comment on function public.set_event_volunteer_only(uuid, boolean) is
    'Administrator-only switch that makes one event volunteer-only (closing household registration) or turns that off.';

revoke all on function private.set_event_volunteer_only(uuid, boolean)
from public, anon, service_role;
grant execute on function private.set_event_volunteer_only(uuid, boolean) to authenticated;

revoke all on function public.set_event_volunteer_only(uuid, boolean) from public, anon;
grant execute on function public.set_event_volunteer_only(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
