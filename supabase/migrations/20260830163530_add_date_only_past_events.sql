-- Support historical events that have a known calendar date but no published
-- time or location. Existing timed events retain their schedule information.

alter table public.events
    add column event_date date;

update public.events
set event_date = (starts_at at time zone 'America/New_York')::date
where event_date is null
  and starts_at is not null;

alter table public.events
    alter column event_date set not null,
    alter column location drop not null,
    alter column starts_at drop not null,
    alter column ends_at drop not null,
    drop constraint events_end_after_start,
    add constraint events_schedule_shape check (
        (starts_at is null and ends_at is null)
        or (
            starts_at is not null
            and ends_at is not null
            and ends_at > starts_at
        )
    );

comment on column public.events.event_date is
    'Calendar date for the event in America/New_York. Required even when the event has no published time.';

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
    events.event_date
from public.events
where events.deleted_at is null;

comment on view public.event_catalog is
    'RLS-aware event discovery view whose lifecycle changes automatically from upcoming to past after ends_at or event_date.';

revoke all on public.event_catalog from public;
grant select on public.event_catalog to anon, authenticated;

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
    exception when others then
        raise exception 'Event date, times, capacity, or publication settings are invalid.' using errcode = '22023';
    end;

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
            published
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
            event_published
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
            published = event_published
        where id = p_event_id
        returning id into saved_event_id;

        if saved_event_id is null then
            raise exception 'Event could not be found.' using errcode = 'P0002';
        end if;
    end if;

    return saved_event_id;
end;
$$;

-- Update the existing field-day record in place. Matching by its current
-- title and date avoids hardcoding a generated UUID in this data migration.
update public.events
set
    description = 'PCA hosted a field day to enjoy the summer heat! Participants competed in relay races and water balloon fights for a lot of outdoor fun. In addition to outdoor activities, there was a slime and bookmark-making segment for attendees to express their creativity. We also had a guest, Milo, who showed off their Lego expertise.',
    location = null,
    event_date = date '2026-07-25',
    starts_at = null,
    ends_at = null,
    registration_open = false,
    published = true
where title = '2026 Field Day'
  and event_date = date '2026-07-25'
  and deleted_at is null;

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
    published
)
select incoming.title,
       incoming.description,
       null,
       incoming.event_date,
       null,
       null,
       50,
       6,
       false,
       true
from (
    values
        (
            'Cultural Festival',
            'PCA participated in the annual Chinese Cultural Festival at Mellon Park and held activities including face painting and wax seal stamping. Visitors also had the opportunity to check out hand-painted fans, homemade bookmarks, and crocheted trinkets.',
            date '2025-09-13'
        ),
        (
            'Mid Autumn Festival',
            'To celebrate the 2025 Mid Autumn Festival, PCA held an event including mooncakes, lantern and pumpkin decorating, face-painting, and games. Participants mainly consisted of younger children who were able to enjoy the activities and learn more about the festival.',
            date '2025-10-11'
        ),
        (
            'Garden Cleanup',
            'PCA members volunteered at a local community garden to help with seasonal maintenance. Council members worked together to remove weeds, clear overgrown areas, and tidy up the garden to create a healthier environment for plants to thrive.',
            date '2025-10-25'
        ),
        (
            'Flower Planting',
            'PCA participated in a flower planting event at a local community garden to help brighten the space for the season. Volunteers planted a variety of flowers throughout the garden, learned about proper planting techniques, and worked together to improve the garden’s appearance.',
            date '2026-05-23'
        ),
        (
            'Science Event',
            'PCA hosted its first ever science event on November 29th, 2025. Attendees explored polymer chain and non-Newtonian fluid properties through making slime, learned about physics and material sciences through building spaghetti towers, witnessed chemical reactions through the baking soda and vinegar balloon experiment, and gained an understanding of the polarity of different liquids using food coloring and milk. The event was a huge success; council members and attendees alike had a great time exploring the fascinating world of science.',
            date '2025-11-29'
        ),
        (
            'Physics Event',
            'After the success of the science event, PCA decided to follow up with another one tailored to physical science. Attendees explored aerodynamics through airplane design, Bernoulli’s principle through buoyancy experiments with aluminum foil boats, and Newton’s laws with handmade catapults. However, due to confusion regarding the location, attendance was relatively low compared to other events, but the council members are excited to attempt this event again.',
            date '2026-04-04'
        ),
        (
            'CASTP AANHPI Heritage Celebration',
            'To celebrate AANHPI Heritage Month, PCA hosted a table at the Kamin Science Center. Participants were able to learn about different Chinese zodiacs through a paper cutting activity, and they also folded origami papers.',
            date '2026-05-09'
        )
) as incoming(title, description, event_date)
where not exists (
    select 1
    from public.events as existing
    where existing.title = incoming.title
      and existing.event_date = incoming.event_date
      and existing.deleted_at is null
);
