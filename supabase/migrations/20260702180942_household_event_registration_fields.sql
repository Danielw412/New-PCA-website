alter table public.registrations
    add column referral_source text,
    add column referral_source_other text,
    add constraint registrations_referral_source_valid check (coalesce((
        (
            referral_source is null
            and referral_source_other is null
        )
        or
        (
            referral_source in (
                'friend_recommendation',
                'wechat_post',
                'facebook_post',
                'instagram',
                'flyer',
                'poster',
                'website',
                'email',
                'other'
            )
            and (
                (
                    referral_source = 'other'
                    and char_length(btrim(coalesce(referral_source_other, ''))) between 1 and 240
                )
                or
                (
                    referral_source <> 'other'
                    and referral_source_other is null
                )
            )
        )
    ), false));

alter table public.registration_participants
    alter column grade drop not null,
    add column attendee_type text,
    add column age smallint,
    add column school_district text,
    add constraint registration_participants_record_shape_valid check (coalesce((
        (
            grade is not null
            and attendee_type is null
            and age is null
            and school_district is null
        )
        or
        (
            grade is null
            and attendee_type = 'child'
            and age between 0 and 25
            and char_length(btrim(coalesce(school_district, ''))) between 1 and 160
        )
        or
        (
            grade is null
            and attendee_type = 'adult'
            and age is null
            and school_district is null
        )
    ), false));

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    profile_name text := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
begin
    if new.email is null or char_length(btrim(new.email)) not between 3 and 320 then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if char_length(profile_name) not between 1 and 120 then
        raise exception 'Primary contact full name must be between 1 and 120 characters.'
            using errcode = '22023';
    end if;

    insert into public.profiles (id, full_name, email)
    values (new.id, profile_name, btrim(new.email));

    return new;
end;
$$;

drop function public.register_for_event(uuid, jsonb);
drop function private.register_for_event(uuid, jsonb);

create function private.register_for_event(
    p_event_id uuid,
    p_participants jsonb,
    p_referral_source text,
    p_referral_source_other text default null
)
returns table (
    registration_id uuid,
    status public.registration_status,
    participant_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_user_id uuid := auth.uid();
    event_record public.events%rowtype;
    requested_count integer;
    confirmed_count integer;
    assigned_status public.registration_status;
    new_registration_id uuid;
    participant_record record;
    participant_name text;
    participant_type text;
    participant_age_text text;
    participant_age smallint;
    participant_school_district text;
    normalized_referral_source text := lower(btrim(coalesce(p_referral_source, '')));
    normalized_referral_other text := nullif(btrim(coalesce(p_referral_source_other, '')), '');
begin
    if account_user_id is null then
        raise exception 'You must be signed in to register.'
            using errcode = '42501';
    end if;

    if not exists (
        select 1
        from public.profiles
        where id = account_user_id
    ) then
        raise exception 'Your household account profile could not be found.'
            using errcode = 'P0002';
    end if;

    if normalized_referral_source not in (
        'friend_recommendation',
        'wechat_post',
        'facebook_post',
        'instagram',
        'flyer',
        'poster',
        'website',
        'email',
        'other'
    ) then
        raise exception 'Select where you found out about this event.'
            using errcode = '22023';
    end if;

    if normalized_referral_source = 'other' then
        if char_length(coalesce(normalized_referral_other, '')) not between 1 and 240 then
            raise exception 'Describe where you found out about this event.'
                using errcode = '22023';
        end if;
    elsif normalized_referral_other is not null then
        raise exception 'Referral details are only allowed when Other is selected.'
            using errcode = '22023';
    end if;

    if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
        raise exception 'Attendees must be supplied as a list.'
            using errcode = '22023';
    end if;

    requested_count := jsonb_array_length(p_participants);

    if requested_count < 1 then
        raise exception 'Add at least one attendee.'
            using errcode = '22023';
    end if;

    select events.*
    into event_record
    from public.events as events
    where events.id = p_event_id
    for update;

    if not found or not event_record.published then
        raise exception 'This event is not available.'
            using errcode = 'P0002';
    end if;

    if not event_record.registration_open then
        raise exception 'Registration for this event is closed.'
            using errcode = 'P0001';
    end if;

    if event_record.starts_at <= now() then
        raise exception 'Registration closes when the event begins.'
            using errcode = 'P0001';
    end if;

    if requested_count > event_record.max_participants_per_registration then
        raise exception 'This event allows at most % attendees per household account.',
            event_record.max_participants_per_registration
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.registrations
        where event_id = p_event_id
          and account_id = account_user_id
    ) then
        raise exception 'This household account is already registered for the event.'
            using errcode = '23505';
    end if;

    for participant_record in
        select participant.value, participant.ordinality
        from jsonb_array_elements(p_participants) with ordinality as participant(value, ordinality)
    loop
        if jsonb_typeof(participant_record.value) <> 'object' then
            raise exception 'Each attendee must include a name and attendee type.'
                using errcode = '22023';
        end if;

        participant_name := btrim(coalesce(participant_record.value ->> 'full_name', ''));
        participant_type := lower(btrim(coalesce(participant_record.value ->> 'attendee_type', '')));
        participant_age_text := btrim(coalesce(participant_record.value ->> 'age', ''));
        participant_school_district := nullif(
            btrim(coalesce(participant_record.value ->> 'school_district', '')),
            ''
        );

        if char_length(participant_name) not between 1 and 120 then
            raise exception 'Attendee names must be between 1 and 120 characters.'
                using errcode = '22023';
        end if;

        if participant_type not in ('child', 'adult') then
            raise exception 'Select Child / Youth or Adult for every attendee.'
                using errcode = '22023';
        end if;

        if participant_type = 'child' then
            if participant_age_text !~ '^[0-9]{1,2}$' then
                raise exception 'Enter an age from 0 to 25 for every child or youth attendee.'
                    using errcode = '22023';
            end if;

            participant_age := participant_age_text::smallint;

            if participant_age not between 0 and 25 then
                raise exception 'Enter an age from 0 to 25 for every child or youth attendee.'
                    using errcode = '22023';
            end if;

            if char_length(coalesce(participant_school_district, '')) not between 1 and 160 then
                raise exception 'Enter school or school district for every child or youth attendee.'
                    using errcode = '22023';
            end if;
        else
            participant_age := null;

            if participant_age_text <> '' or participant_school_district is not null then
                raise exception 'Age and school information should be left blank for adult attendees.'
                    using errcode = '22023';
            end if;
        end if;
    end loop;

    select coalesce(sum(registrations.participant_count), 0)::integer
    into confirmed_count
    from public.registrations as registrations
    where registrations.event_id = p_event_id
      and registrations.status = 'confirmed';

    assigned_status := case
        when confirmed_count + requested_count <= event_record.capacity
            then 'confirmed'::public.registration_status
        else 'waitlisted'::public.registration_status
    end;

    insert into public.registrations (
        event_id,
        account_id,
        status,
        participant_count,
        referral_source,
        referral_source_other
    )
    values (
        p_event_id,
        account_user_id,
        assigned_status,
        requested_count,
        normalized_referral_source,
        normalized_referral_other
    )
    returning id into new_registration_id;

    insert into public.registration_participants (
        registration_id,
        position,
        full_name,
        attendee_type,
        age,
        school_district
    )
    select
        new_registration_id,
        participant.ordinality::integer,
        btrim(participant.value ->> 'full_name'),
        lower(btrim(participant.value ->> 'attendee_type')),
        case
            when lower(btrim(participant.value ->> 'attendee_type')) = 'child'
                then btrim(participant.value ->> 'age')::smallint
            else null
        end,
        case
            when lower(btrim(participant.value ->> 'attendee_type')) = 'child'
                then btrim(participant.value ->> 'school_district')
            else null
        end
    from jsonb_array_elements(p_participants) with ordinality as participant(value, ordinality);

    return query
    select new_registration_id, assigned_status, requested_count;
end;
$$;

create function public.register_for_event(
    p_event_id uuid,
    p_participants jsonb,
    p_referral_source text,
    p_referral_source_other text default null
)
returns table (
    registration_id uuid,
    status public.registration_status,
    participant_count integer
)
language sql
security invoker
set search_path = ''
as $$
    select *
    from private.register_for_event($1, $2, $3, $4);
$$;

revoke execute on function private.register_for_event(uuid, jsonb, text, text)
    from public, anon, authenticated;
revoke execute on function public.register_for_event(uuid, jsonb, text, text)
    from public, anon, authenticated;

grant execute on function private.register_for_event(uuid, jsonb, text, text)
    to authenticated;
grant execute on function public.register_for_event(uuid, jsonb, text, text)
    to authenticated;

comment on column public.registrations.referral_source is
    'How the household learned about the event. Null only for registrations created before this field was introduced.';
comment on column public.profiles.full_name is
    'Primary contact name for the household account.';
comment on column public.registration_participants.grade is
    'Legacy grade value. New registrations use attendee_type, age, and school_district.';
comment on function public.register_for_event(uuid, jsonb, text, text) is
    'Registers every attendee in a signed-in household. Capacity and status are assigned atomically by the database.';
