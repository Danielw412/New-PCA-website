-- Let administrators ask event-specific questions when volunteers sign up.
-- Each event keeps its questions in events.volunteer_questions. Every volunteer
-- request stores the questions it was asked next to the answers, so editing an
-- event later never rewrites answers PCA already received.

-- Validates and canonicalizes one event's question list. Question ids come
-- from the browser so a question keeps its id when its wording changes; the
-- function is immutable so the events check constraint can reuse it.
create function private.normalize_event_volunteer_questions(p_questions jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
    question jsonb;
    question_id text;
    question_label text;
    question_type text;
    question_required boolean;
    choice jsonb;
    choice_text text;
    normalized_choices jsonb;
    seen_ids text[] := '{}';
    normalized jsonb := '[]'::jsonb;
begin
    if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
        raise exception 'Volunteer questions must be a list.' using errcode = '22023';
    end if;

    if jsonb_array_length(p_questions) > 10 then
        raise exception 'Add up to 10 volunteer questions.' using errcode = '22023';
    end if;

    for question in select value from jsonb_array_elements(p_questions)
    loop
        if jsonb_typeof(question) <> 'object'
           or jsonb_typeof(question -> 'id') is distinct from 'string'
           or jsonb_typeof(question -> 'label') is distinct from 'string'
           or jsonb_typeof(question -> 'type') is distinct from 'string'
           or coalesce(jsonb_typeof(question -> 'required'), 'boolean') <> 'boolean' then
            raise exception 'Each volunteer question needs text and an answer type.' using errcode = '22023';
        end if;

        question_id := question ->> 'id';
        question_label := btrim(question ->> 'label');
        question_type := question ->> 'type';
        question_required := coalesce((question ->> 'required')::boolean, false);

        if question_id !~ '^[A-Za-z0-9_-]{1,64}$' then
            raise exception 'Each volunteer question needs a valid id.' using errcode = '22023';
        end if;

        if question_id = any (seen_ids) then
            raise exception 'Volunteer question ids must be unique.' using errcode = '22023';
        end if;
        seen_ids := seen_ids || question_id;

        if char_length(question_label) not between 1 and 300 then
            raise exception 'Volunteer questions must be 1 to 300 characters.' using errcode = '22023';
        end if;

        if question_type not in ('short_text', 'long_text', 'yes_no', 'single_choice', 'multiple_choice') then
            raise exception 'Choose an answer type for: %', question_label using errcode = '22023';
        end if;

        normalized_choices := '[]'::jsonb;
        if question_type in ('single_choice', 'multiple_choice') then
            if jsonb_typeof(question -> 'options') is distinct from 'array' then
                raise exception 'Add at least two choices for: %', question_label using errcode = '22023';
            end if;

            for choice in select value from jsonb_array_elements(question -> 'options')
            loop
                if jsonb_typeof(choice) <> 'string' then
                    raise exception 'Choices must be text for: %', question_label using errcode = '22023';
                end if;
                choice_text := btrim(choice #>> '{}');
                if char_length(choice_text) not between 1 and 120 then
                    raise exception 'Choices must be 1 to 120 characters for: %', question_label using errcode = '22023';
                end if;
                if normalized_choices @> jsonb_build_array(choice_text) then
                    raise exception 'Each choice must be different for: %', question_label using errcode = '22023';
                end if;
                normalized_choices := normalized_choices || jsonb_build_array(choice_text);
            end loop;

            if jsonb_array_length(normalized_choices) not between 2 and 20 then
                raise exception 'Add 2 to 20 choices for: %', question_label using errcode = '22023';
            end if;
        end if;

        normalized := normalized || jsonb_build_array(jsonb_build_object(
            'id', question_id,
            'label', question_label,
            'type', question_type,
            'required', question_required,
            'options', normalized_choices
        ));
    end loop;

    return normalized;
end;
$$;

comment on function private.normalize_event_volunteer_questions(jsonb) is
    'Validates an event volunteer question list and returns it in canonical form.';

-- The events check constraint runs this function as whoever writes the row.
revoke all on function private.normalize_event_volunteer_questions(jsonb) from public, anon;
grant execute on function private.normalize_event_volunteer_questions(jsonb) to authenticated, service_role;

alter table public.events
    add column volunteer_questions jsonb not null default '[]'::jsonb;

alter table public.events
    add constraint events_volunteer_questions_valid check (
        private.normalize_event_volunteer_questions(volunteer_questions) = volunteer_questions
    );

comment on column public.events.volunteer_questions is
    'Questions volunteers answer when they request to help at this event. Edited through save_event.';

alter table public.event_volunteer_requests
    add column question_answers jsonb not null default '[]'::jsonb;

alter table public.event_volunteer_requests
    add constraint event_volunteer_requests_question_answers_shape check (
        jsonb_typeof(question_answers) = 'array'
        and jsonb_array_length(question_answers) <= 10
    );

comment on column public.event_volunteer_requests.question_answers is
    'Snapshot of each event question the volunteer was asked and their answer, written only by submit_event_volunteer_request.';

-- save_event keeps the stored questions when the payload has no
-- volunteer_questions key, so an older cached admin page cannot erase them.
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
            volunteer_questions
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
            coalesce(event_volunteer_questions, '[]'::jsonb)
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
            volunteer_questions = coalesce(event_volunteer_questions, events.volunteer_questions)
        where id = p_event_id
        returning id into saved_event_id;

        if saved_event_id is null then
            raise exception 'Event could not be found.' using errcode = 'P0002';
        end if;
    end if;

    return saved_event_id;
end;
$$;

-- p_request.answers maps each question id to a string, or to a list of
-- strings for multiple_choice. The browser sends every question it showed,
-- even unanswered ones, so a missing id means the questions changed after the
-- page loaded and the volunteer has to see the new ones first.
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
    submitted_answers jsonb := coalesce(p_request -> 'answers', '{}'::jsonb);
    requested_age smallint;
    wants_updates boolean := coalesce((p_request ->> 'future_event_emails')::boolean, true);
    signups_open boolean;
    event_questions jsonb;
    question jsonb;
    answer_value jsonb;
    answer_text text;
    answer_choices jsonb;
    saved_answers jsonb := '[]'::jsonb;
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

    if jsonb_typeof(submitted_answers) <> 'object' then
        raise exception 'Answer the event questions again.' using errcode = '22023';
    end if;

    -- FOR SHARE waits for an in-flight "end sign-ups" or question update and
    -- then reads the committed row, so answers match the questions in effect.
    select events.volunteer_signups_open, events.volunteer_questions
    into signups_open, event_questions
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

    for question in select value from jsonb_array_elements(event_questions)
    loop
        if not submitted_answers ? (question ->> 'id') then
            raise exception 'The questions for this event changed. Refresh the page and answer them again.' using errcode = '22023';
        end if;
        answer_value := submitted_answers -> (question ->> 'id');

        if question ->> 'type' = 'multiple_choice' then
            if jsonb_typeof(answer_value) <> 'array'
               or exists (
                   select 1
                   from jsonb_array_elements(answer_value) as chosen (value)
                   where not (question -> 'options') @> jsonb_build_array(chosen.value)
               ) then
                raise exception 'Choose from the listed options for: %', question ->> 'label' using errcode = '22023';
            end if;

            -- Keep the administrator's order and drop repeated picks.
            select coalesce(jsonb_agg(choice.value order by choice.ordinal), '[]'::jsonb)
            into answer_choices
            from jsonb_array_elements(question -> 'options') with ordinality as choice (value, ordinal)
            where answer_value @> jsonb_build_array(choice.value);

            if (question ->> 'required')::boolean and jsonb_array_length(answer_choices) = 0 then
                raise exception 'Answer this question: %', question ->> 'label' using errcode = '22023';
            end if;

            saved_answers := saved_answers || jsonb_build_array(jsonb_build_object(
                'question_id', question ->> 'id',
                'question', question ->> 'label',
                'type', question ->> 'type',
                'answer', answer_choices
            ));
        else
            if jsonb_typeof(answer_value) not in ('string', 'null') then
                raise exception 'Answer this question with text: %', question ->> 'label' using errcode = '22023';
            end if;
            answer_text := btrim(coalesce(answer_value #>> '{}', ''));

            if question ->> 'type' = 'short_text' and char_length(answer_text) > 300 then
                raise exception 'Keep this answer to 300 characters or fewer: %', question ->> 'label' using errcode = '22023';
            end if;

            if question ->> 'type' = 'long_text' and char_length(answer_text) > 2000 then
                raise exception 'Keep this answer to 2,000 characters or fewer: %', question ->> 'label' using errcode = '22023';
            end if;

            if question ->> 'type' = 'yes_no' and answer_text not in ('', 'Yes', 'No') then
                raise exception 'Choose Yes or No for: %', question ->> 'label' using errcode = '22023';
            end if;

            if question ->> 'type' = 'single_choice'
               and answer_text <> ''
               and not (question -> 'options') @> jsonb_build_array(answer_text) then
                raise exception 'Choose from the listed options for: %', question ->> 'label' using errcode = '22023';
            end if;

            if (question ->> 'required')::boolean and answer_text = '' then
                raise exception 'Answer this question: %', question ->> 'label' using errcode = '22023';
            end if;

            saved_answers := saved_answers || jsonb_build_array(jsonb_build_object(
                'question_id', question ->> 'id',
                'question', question ->> 'label',
                'type', question ->> 'type',
                'answer', answer_text
            ));
        end if;
    end loop;

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
        future_event_emails,
        question_answers
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
        wants_updates,
        saved_answers
    )
    returning id into saved_request_id;

    return query select saved_request_id, 'pending'::text;
exception
    when unique_violation then
        raise exception 'A volunteer request for this email and event is already pending or approved.'
            using errcode = '23505';
end;
$$;

notify pgrst, 'reload schema';
