-- Transactional platform operations created after the expanded enum value has
-- committed. All browser writes that affect capacity, claims, access, or
-- approval state pass through these locked-down functions.

alter table public.registrations
    drop constraint registrations_one_group_per_event;

create unique index registrations_one_active_group_per_event
    on public.registrations (event_id, account_id)
    where account_id is not null and status <> 'cancelled';

create function private.is_anonymous_user(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select check_user_id is not null and exists (
        select 1
        from auth.users
        where users.id = check_user_id
          and users.is_anonymous = true
    );
$$;

create or replace function private.ensure_household_registration()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.account_id is null then
        raise exception 'A registration owner is required.' using errcode = '42501';
    end if;

    if new.registration_source = 'guest' then
        if new.account_id <> auth.uid() or not private.is_anonymous_user(new.account_id) then
            raise exception 'Guest registration requires the current anonymous session.'
                using errcode = '42501';
        end if;
    elsif not exists (
        select 1
        from public.profiles
        where profiles.id = new.account_id
          and profiles.account_type = 'household'
    ) then
        raise exception 'Event registration requires a household account.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

create function private.parse_event_attendees(
    p_attendees jsonb,
    p_owner_user_id uuid
)
returns table (
    attendee_position integer,
    attendee_name text,
    attendee_type text,
    attendee_age smallint,
    attendee_school_district text,
    saved_household_member_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    attendee_record record;
    age_text text;
    member_id_text text;
begin
    if p_attendees is null or jsonb_typeof(p_attendees) <> 'array' then
        raise exception 'Attendees must be supplied as a list.' using errcode = '22023';
    end if;

    if jsonb_array_length(p_attendees) < 1 then
        raise exception 'Add at least one attendee.' using errcode = '22023';
    end if;

    for attendee_record in
        select attendee.value, attendee.ordinality
        from jsonb_array_elements(p_attendees) with ordinality as attendee(value, ordinality)
    loop
        if jsonb_typeof(attendee_record.value) <> 'object' then
            raise exception 'Each attendee must be an object.' using errcode = '22023';
        end if;

        attendee_position := attendee_record.ordinality::integer;
        attendee_name := btrim(coalesce(attendee_record.value ->> 'full_name', ''));
        attendee_type := lower(btrim(coalesce(attendee_record.value ->> 'attendee_type', '')));
        age_text := btrim(coalesce(attendee_record.value ->> 'age', ''));
        attendee_school_district := nullif(
            btrim(coalesce(attendee_record.value ->> 'school_district', '')),
            ''
        );
        member_id_text := btrim(coalesce(attendee_record.value ->> 'household_member_id', ''));
        saved_household_member_id := null;

        if char_length(attendee_name) not between 1 and 120 then
            raise exception 'Attendee names must be between 1 and 120 characters.'
                using errcode = '22023';
        end if;

        if attendee_type not in ('child', 'adult') then
            raise exception 'Select Child / Youth or Adult for every attendee.'
                using errcode = '22023';
        end if;

        if attendee_type = 'child' then
            if age_text !~ '^[0-9]{1,2}$' then
                raise exception 'Enter an age from 0 to 25 for every child or youth attendee.'
                    using errcode = '22023';
            end if;

            attendee_age := age_text::smallint;

            if attendee_age not between 0 and 25 then
                raise exception 'Enter an age from 0 to 25 for every child or youth attendee.'
                    using errcode = '22023';
            end if;

            if char_length(coalesce(attendee_school_district, '')) not between 1 and 160 then
                raise exception 'Enter school or school district for every child or youth attendee.'
                    using errcode = '22023';
            end if;
        else
            attendee_age := null;

            if age_text <> '' or attendee_school_district is not null then
                raise exception 'Age and school information should be blank for adult attendees.'
                    using errcode = '22023';
            end if;
        end if;

        if member_id_text <> '' then
            if member_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
                raise exception 'Saved household member reference is invalid.' using errcode = '22023';
            end if;

            saved_household_member_id := member_id_text::uuid;

            if p_owner_user_id is null or not exists (
                select 1
                from public.household_members
                where household_members.id = saved_household_member_id
                  and household_members.account_id = p_owner_user_id
            ) then
                raise exception 'Saved household member does not belong to this account.'
                    using errcode = '42501';
            end if;
        end if;

        return next;
    end loop;
end;
$$;

create function private.promote_event_waitlist(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    event_capacity integer;
    confirmed_count integer;
    waiting_registration record;
begin
    select events.capacity
    into event_capacity
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
        select registrations.id, registrations.participant_count
        from public.registrations
        where registrations.event_id = p_event_id
          and registrations.status = 'waitlisted'
        order by registrations.created_at, registrations.id
        for update
    loop
        if confirmed_count + waiting_registration.participant_count > event_capacity then
            exit;
        end if;

        update public.registrations
        set status = 'confirmed'
        where id = waiting_registration.id;

        confirmed_count := confirmed_count + waiting_registration.participant_count;
    end loop;
end;
$$;

create function private.register_for_event_v2(
    p_event_id uuid,
    p_contact jsonb,
    p_attendees jsonb,
    p_referral_source text,
    p_referral_source_other text default null
)
returns table (
    registration_id uuid,
    status public.registration_status,
    participant_count integer,
    guest_claim_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_user_id uuid := auth.uid();
    profile_record public.profiles%rowtype;
    event_record public.events%rowtype;
    requested_count integer;
    confirmed_count integer;
    assigned_status public.registration_status;
    new_registration_id uuid;
    is_guest boolean;
    normalized_contact_name text;
    normalized_contact_email text;
    normalized_contact_phone text;
    normalized_referral_source text := lower(btrim(coalesce(p_referral_source, '')));
    normalized_referral_other text := nullif(btrim(coalesce(p_referral_source_other, '')), '');
    raw_claim_token text;
begin
    if account_user_id is null then
        raise exception 'Start a guest session or sign in before registering.'
            using errcode = '42501';
    end if;

    select profiles.*
    into profile_record
    from public.profiles
    where profiles.id = account_user_id;

    is_guest := not found;

    if is_guest then
        if not private.is_anonymous_user(account_user_id) then
            raise exception 'Complete your account profile before registering.'
                using errcode = '42501';
        end if;
    elsif profile_record.account_type <> 'household' then
        raise exception 'Event attendee registration requires a household account.'
            using errcode = '42501';
    end if;

    if p_contact is null or jsonb_typeof(p_contact) <> 'object' then
        p_contact := '{}'::jsonb;
    end if;

    normalized_contact_name := nullif(btrim(coalesce(p_contact ->> 'full_name', profile_record.full_name, '')), '');
    normalized_contact_email := lower(nullif(btrim(coalesce(
        p_contact ->> 'email',
        profile_record.contact_email,
        profile_record.email,
        ''
    )), ''));
    normalized_contact_phone := nullif(btrim(coalesce(p_contact ->> 'phone', profile_record.contact_phone, '')), '');

    if char_length(coalesce(normalized_contact_name, '')) not between 1 and 120 then
        raise exception 'Contact name must be between 1 and 120 characters.' using errcode = '22023';
    end if;

    if char_length(coalesce(normalized_contact_email, '')) not between 3 and 320
       or normalized_contact_email !~ '^[^[:space:]@]+@[^[:space:]@]+\\.[^[:space:]@]+$' then
        raise exception 'Enter a valid contact email address.' using errcode = '22023';
    end if;

    if char_length(coalesce(normalized_contact_phone, '')) not between 7 and 40 then
        raise exception 'Contact phone must be between 7 and 40 characters.' using errcode = '22023';
    end if;

    if not is_guest then
        update public.profiles
        set
            full_name = normalized_contact_name,
            contact_email = normalized_contact_email,
            contact_phone = normalized_contact_phone
        where id = account_user_id;
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
        raise exception 'Select where you found out about this event.' using errcode = '22023';
    end if;

    if normalized_referral_source = 'other' then
        if char_length(coalesce(normalized_referral_other, '')) not between 1 and 240 then
            raise exception 'Describe where you found out about this event.' using errcode = '22023';
        end if;
    elsif normalized_referral_other is not null then
        raise exception 'Referral details are only allowed when Other is selected.' using errcode = '22023';
    end if;

    requested_count := jsonb_array_length(p_attendees);

    -- Parse once before locking the event so invalid data fails quickly.
    perform * from private.parse_event_attendees(p_attendees, case when is_guest then null else account_user_id end);

    select events.*
    into event_record
    from public.events
    where events.id = p_event_id
    for update;

    if not found or not event_record.published then
        raise exception 'This event is not available.' using errcode = 'P0002';
    end if;

    if not event_record.registration_open then
        raise exception 'Registration for this event is closed.' using errcode = 'P0001';
    end if;

    if event_record.starts_at <= now() then
        raise exception 'Registration closes when the event begins.' using errcode = 'P0001';
    end if;

    if requested_count > event_record.max_participants_per_registration then
        raise exception 'This event allows at most % attendees per registration.',
            event_record.max_participants_per_registration using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.registrations
        where registrations.event_id = p_event_id
          and registrations.account_id = account_user_id
          and registrations.status <> 'cancelled'
    ) then
        raise exception 'This account is already registered for the event.' using errcode = '23505';
    end if;

    select coalesce(sum(registrations.participant_count), 0)::integer
    into confirmed_count
    from public.registrations
    where registrations.event_id = p_event_id
      and registrations.status = 'confirmed';

    assigned_status := case
        when confirmed_count + requested_count <= event_record.capacity then 'confirmed'
        else 'waitlisted'
    end;

    insert into public.registrations (
        event_id,
        account_id,
        registration_source,
        contact_name,
        contact_email,
        contact_phone,
        status,
        participant_count,
        referral_source,
        referral_source_other
    )
    values (
        p_event_id,
        account_user_id,
        case when is_guest then 'guest' else 'household' end,
        normalized_contact_name,
        normalized_contact_email,
        normalized_contact_phone,
        assigned_status,
        requested_count,
        normalized_referral_source,
        normalized_referral_other
    )
    returning id into new_registration_id;

    insert into public.registration_participants (
        registration_id,
        household_member_id,
        position,
        full_name,
        attendee_type,
        age,
        school_district
    )
    select
        new_registration_id,
        parsed.saved_household_member_id,
        parsed.attendee_position,
        parsed.attendee_name,
        parsed.attendee_type,
        parsed.attendee_age,
        parsed.attendee_school_district
    from private.parse_event_attendees(
        p_attendees,
        case when is_guest then null else account_user_id end
    ) as parsed;

    raw_claim_token := null;

    if is_guest then
        raw_claim_token := encode(extensions.gen_random_bytes(32), 'hex');

        insert into public.guest_registration_claims (
            registration_id,
            token_hash,
            intended_email,
            expires_at
        )
        values (
            new_registration_id,
            extensions.digest(pg_catalog.convert_to(raw_claim_token, 'UTF8'), 'sha256'),
            normalized_contact_email,
            now() + interval '30 minutes'
        );
    end if;

    return query
    select new_registration_id, assigned_status, requested_count, raw_claim_token;
end;
$$;

create function public.register_for_event(
    p_event_id uuid,
    p_contact jsonb,
    p_attendees jsonb,
    p_referral_source text,
    p_referral_source_other text default null
)
returns table (
    registration_id uuid,
    status public.registration_status,
    participant_count integer,
    guest_claim_token text
)
language sql
security invoker
set search_path = ''
as $$
    select *
    from private.register_for_event_v2($1, $2, $3, $4, $5);
$$;

create function private.update_event_registration(
    p_registration_id uuid,
    p_contact jsonb,
    p_attendees jsonb
)
returns table (
    status public.registration_status,
    participant_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    registration_record public.registrations%rowtype;
    event_record public.events%rowtype;
    target_event_id uuid;
    requested_count integer;
    occupied_without_registration integer;
    caller_is_admin boolean := private.is_site_administrator(current_user_id);
    owner_is_permanent boolean;
    new_contact_name text;
    new_contact_email text;
    new_contact_phone text;
begin
    if current_user_id is null then
        raise exception 'You must be signed in.' using errcode = '42501';
    end if;

    select registrations.event_id
    into target_event_id
    from public.registrations
    where registrations.id = p_registration_id;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;

    select events.*
    into event_record
    from public.events
    where events.id = target_event_id
    for update;

    select registrations.*
    into registration_record
    from public.registrations
    where registrations.id = p_registration_id
    for update;

    owner_is_permanent := private.is_permanent_user(registration_record.account_id);

    if not caller_is_admin and (
        registration_record.account_id <> current_user_id
        or not owner_is_permanent
    ) then
        raise exception 'Guest registrations can be changed after creating or attaching an account.'
            using errcode = '42501';
    end if;

    if registration_record.status = 'cancelled' then
        raise exception 'Cancelled registrations cannot be edited.' using errcode = 'P0001';
    end if;

    if not caller_is_admin and event_record.starts_at <= now() then
        raise exception 'This event has already started.' using errcode = 'P0001';
    end if;

    requested_count := jsonb_array_length(p_attendees);
    perform * from private.parse_event_attendees(p_attendees, case when owner_is_permanent then registration_record.account_id else null end);

    if requested_count > event_record.max_participants_per_registration then
        raise exception 'This event allows at most % attendees per registration.',
            event_record.max_participants_per_registration using errcode = '22023';
    end if;

    if requested_count > registration_record.participant_count then
        if not event_record.registration_open or event_record.starts_at <= now() then
            raise exception 'Attendees can only be added while registration is open.' using errcode = 'P0001';
        end if;

        if registration_record.status = 'confirmed' then
            select coalesce(sum(registrations.participant_count), 0)::integer
            into occupied_without_registration
            from public.registrations
            where registrations.event_id = registration_record.event_id
              and registrations.status = 'confirmed'
              and registrations.id <> registration_record.id;

            if occupied_without_registration + requested_count > event_record.capacity then
                raise exception 'The added attendees do not fit. Your existing confirmed seats were not changed.'
                    using errcode = 'P0001';
            end if;
        end if;
    end if;

    p_contact := coalesce(p_contact, '{}'::jsonb);
    new_contact_name := coalesce(nullif(btrim(p_contact ->> 'full_name'), ''), registration_record.contact_name);
    new_contact_email := lower(coalesce(nullif(btrim(p_contact ->> 'email'), ''), registration_record.contact_email));
    new_contact_phone := coalesce(nullif(btrim(p_contact ->> 'phone'), ''), registration_record.contact_phone);

    if char_length(coalesce(new_contact_name, '')) not between 1 and 120
       or char_length(coalesce(new_contact_email, '')) not between 3 and 320
       or char_length(coalesce(new_contact_phone, '')) not between 7 and 40 then
        raise exception 'Complete the contact name, email, and phone.' using errcode = '22023';
    end if;

    if owner_is_permanent and not caller_is_admin then
        update public.profiles
        set
            full_name = new_contact_name,
            contact_email = new_contact_email,
            contact_phone = new_contact_phone
        where id = registration_record.account_id;
    end if;

    update public.registrations
    set
        contact_name = new_contact_name,
        contact_email = new_contact_email,
        contact_phone = new_contact_phone,
        participant_count = requested_count
    where id = registration_record.id;

    delete from public.registration_participants
    where registration_id = registration_record.id;

    insert into public.registration_participants (
        registration_id,
        household_member_id,
        position,
        full_name,
        attendee_type,
        age,
        school_district
    )
    select
        registration_record.id,
        parsed.saved_household_member_id,
        parsed.attendee_position,
        parsed.attendee_name,
        parsed.attendee_type,
        parsed.attendee_age,
        parsed.attendee_school_district
    from private.parse_event_attendees(
        p_attendees,
        case when owner_is_permanent then registration_record.account_id else null end
    ) as parsed;

    if requested_count < registration_record.participant_count
       or registration_record.status = 'waitlisted' then
        perform private.promote_event_waitlist(registration_record.event_id);
    end if;

    return query
    select registrations.status, registrations.participant_count
    from public.registrations
    where registrations.id = registration_record.id;
end;
$$;

create function public.update_event_registration(
    p_registration_id uuid,
    p_contact jsonb,
    p_attendees jsonb
)
returns table (
    status public.registration_status,
    participant_count integer
)
language sql
security invoker
set search_path = ''
as $$
    select * from private.update_event_registration($1, $2, $3);
$$;

create function private.cancel_event_registration(p_registration_id uuid)
returns public.registration_status
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    registration_record public.registrations%rowtype;
    event_start timestamptz;
    target_event_id uuid;
    caller_is_admin boolean := private.is_site_administrator(current_user_id);
begin
    select registrations.event_id
    into target_event_id
    from public.registrations
    where registrations.id = p_registration_id;

    if not found then
        raise exception 'Registration could not be found.' using errcode = 'P0002';
    end if;

    select events.starts_at
    into event_start
    from public.events
    where events.id = target_event_id
    for update;

    select registrations.*
    into registration_record
    from public.registrations
    where registrations.id = p_registration_id
    for update;

    if not caller_is_admin and (
        registration_record.account_id <> current_user_id
        or not private.is_permanent_user(current_user_id)
    ) then
        raise exception 'Guest registrations can be cancelled after creating or attaching an account.'
            using errcode = '42501';
    end if;

    if not caller_is_admin and event_start <= now() then
        raise exception 'This event has already started.' using errcode = 'P0001';
    end if;

    if registration_record.status = 'cancelled' then
        return 'cancelled';
    end if;

    update public.registrations
    set status = 'cancelled', cancelled_at = now()
    where id = registration_record.id;

    if registration_record.status = 'confirmed' then
        perform private.promote_event_waitlist(registration_record.event_id);
    end if;

    return 'cancelled';
end;
$$;

create function public.cancel_event_registration(p_registration_id uuid)
returns public.registration_status
language sql
security invoker
set search_path = ''
as $$
    select private.cancel_event_registration($1);
$$;

create function private.claim_guest_registration(
    p_claim_token text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    claim_record public.guest_registration_claims%rowtype;
    registration_record public.registrations%rowtype;
    profile_email text;
begin
    if not private.is_permanent_user(current_user_id) then
        raise exception 'Sign in to a permanent account before claiming a registration.'
            using errcode = '42501';
    end if;

    if char_length(btrim(coalesce(p_claim_token, ''))) <> 64 then
        raise exception 'Claim link is invalid.' using errcode = '22023';
    end if;

    select claims.*
    into claim_record
    from public.guest_registration_claims as claims
    where claims.token_hash = extensions.digest(
        pg_catalog.convert_to(btrim(p_claim_token), 'UTF8'),
        'sha256'
    )
    for update;

    if not found or claim_record.claimed_at is not null or claim_record.expires_at <= now() then
        raise exception 'This claim link is invalid or has expired.' using errcode = 'P0001';
    end if;

    select lower(coalesce(profiles.contact_email, profiles.email))
    into profile_email
    from public.profiles
    where profiles.id = current_user_id;

    if profile_email <> lower(claim_record.intended_email) then
        raise exception 'Sign in with the email address used for the guest registration.'
            using errcode = '42501';
    end if;

    select registrations.*
    into registration_record
    from public.registrations
    where registrations.id = claim_record.registration_id
    for update;

    if exists (
        select 1
        from public.registrations
        where registrations.event_id = registration_record.event_id
          and registrations.account_id = current_user_id
          and registrations.status <> 'cancelled'
    ) then
        raise exception 'This account already has a registration for the event.' using errcode = '23505';
    end if;

    update public.registrations
    set account_id = current_user_id
    where id = registration_record.id;

    update public.guest_registration_claims
    set claimed_by = current_user_id, claimed_at = now()
    where id = claim_record.id;

    return registration_record.id;
end;
$$;

create function public.claim_guest_registration(p_claim_token text)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.claim_guest_registration($1);
$$;

create function private.complete_household_account(
    p_full_name text,
    p_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    auth_email text;
    account_is_anonymous boolean;
    normalized_name text := btrim(coalesce(p_full_name, ''));
    normalized_phone text := btrim(coalesce(p_contact_phone, ''));
begin
    if current_user_id is null then
        raise exception 'Your account session has expired.' using errcode = '42501';
    end if;

    if exists (select 1 from public.profiles where profiles.id = current_user_id) then
        return current_user_id;
    end if;

    select users.email, users.is_anonymous
    into auth_email, account_is_anonymous
    from auth.users
    where users.id = current_user_id;

    if not found or account_is_anonymous or auth_email is null then
        raise exception 'Verify the email address and create a password before completing the account.'
            using errcode = '42501';
    end if;

    if char_length(normalized_name) not between 1 and 120 then
        raise exception 'Account holder name must be between 1 and 120 characters.' using errcode = '22023';
    end if;

    if char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Contact phone must be between 7 and 40 characters.' using errcode = '22023';
    end if;

    insert into public.profiles (
        id,
        full_name,
        email,
        contact_email,
        contact_phone,
        account_type,
        account_use
    )
    values (
        current_user_id,
        normalized_name,
        lower(btrim(auth_email)),
        lower(btrim(auth_email)),
        normalized_phone,
        'household',
        'household'
    );

    update public.registrations
    set
        registration_source = 'household',
        contact_name = normalized_name,
        contact_email = lower(btrim(auth_email)),
        contact_phone = normalized_phone
    where account_id = current_user_id;

    update public.guest_registration_claims as claims
    set claimed_by = current_user_id, claimed_at = now()
    from public.registrations as registrations
    where registrations.id = claims.registration_id
      and registrations.account_id = current_user_id
      and claims.claimed_at is null;

    return current_user_id;
end;
$$;

create function public.complete_household_account(
    p_full_name text,
    p_contact_phone text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.complete_household_account($1, $2);
$$;

create function private.save_event(
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
    event_location text := btrim(coalesce(p_event ->> 'location', ''));
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
        event_starts_at := (p_event ->> 'starts_at')::timestamptz;
        event_ends_at := (p_event ->> 'ends_at')::timestamptz;
        event_capacity := (p_event ->> 'capacity')::integer;
        event_group_limit := (p_event ->> 'max_participants_per_registration')::integer;
        event_registration_open := coalesce((p_event ->> 'registration_open')::boolean, true);
        event_published := coalesce((p_event ->> 'published')::boolean, false);
    exception when others then
        raise exception 'Event dates, capacity, or publication settings are invalid.' using errcode = '22023';
    end;

    if char_length(event_title) not between 1 and 160
       or char_length(event_description) > 5000
       or char_length(event_location) not between 1 and 240
       or event_ends_at <= event_starts_at
       or event_capacity < 1
       or event_group_limit < 1
       or event_group_limit > event_capacity then
        raise exception 'Complete all event fields with valid values.' using errcode = '22023';
    end if;

    if p_event_id is null then
        insert into public.events (
            title,
            description,
            location,
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

create function public.save_event(p_event_id uuid, p_event jsonb)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.save_event($1, $2);
$$;

create function private.delete_event_draft(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    delete from public.events
    where events.id = p_event_id
      and events.published = false
      and not exists (
          select 1 from public.registrations
          where registrations.event_id = events.id
      );

    if not found then
        raise exception 'Only unused draft events can be deleted.' using errcode = 'P0001';
    end if;
end;
$$;

create function public.delete_event_draft(p_event_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.delete_event_draft($1);
$$;

create function private.review_teen_member_application(
    p_application_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    applicant_user_id uuid;
    normalized_decision text := lower(btrim(coalesce(p_decision, '')));
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if normalized_decision not in ('approved', 'rejected') then
        raise exception 'Choose approved or rejected.' using errcode = '22023';
    end if;

    if char_length(coalesce(p_admin_notes, '')) > 4000 then
        raise exception 'Administrator notes are too long.' using errcode = '22023';
    end if;

    update public.volunteer_applications
    set
        status = normalized_decision::public.volunteer_application_status,
        admin_notes = coalesce(p_admin_notes, '')
    where id = p_application_id
    returning user_id into applicant_user_id;

    if applicant_user_id is null then
        raise exception 'Teen member application could not be found.' using errcode = 'P0002';
    end if;

    update public.profiles
    set account_type = 'teen_member'
    where id = applicant_user_id;

    if normalized_decision = 'rejected' then
        update public.teen_member_role_assignments
        set revoked_by = auth.uid(), revoked_at = now()
        where user_id = applicant_user_id
          and revoked_at is null;
    end if;

    return applicant_user_id;
end;
$$;

create function public.review_teen_member_application(
    p_application_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.review_teen_member_application($1, $2, $3);
$$;

create function private.replace_teen_member_roles(
    p_user_id uuid,
    p_roles public.teen_member_role[]
)
returns public.teen_member_role[]
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_roles public.teen_member_role[];
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    select coalesce(array_agg(distinct requested_role), '{}'::public.teen_member_role[])
    into normalized_roles
    from unnest(coalesce(p_roles, '{}'::public.teen_member_role[])) as requested_role;

    if not exists (
        select 1
        from public.volunteer_applications
        where volunteer_applications.user_id = p_user_id
          and volunteer_applications.status = 'approved'
    ) then
        raise exception 'Approve the teen member application before assigning roles.'
            using errcode = 'P0001';
    end if;

    update public.teen_member_role_assignments
    set revoked_by = auth.uid(), revoked_at = now()
    where user_id = p_user_id
      and revoked_at is null
      and not (role = any(normalized_roles));

    insert into public.teen_member_role_assignments (user_id, role, assigned_by)
    select p_user_id, requested_role, auth.uid()
    from unnest(normalized_roles) as requested_role
    where not exists (
        select 1
        from public.teen_member_role_assignments
        where teen_member_role_assignments.user_id = p_user_id
          and teen_member_role_assignments.role = requested_role
          and teen_member_role_assignments.revoked_at is null
    );

    if 'volunteer'::public.teen_member_role = any(normalized_roles) then
        insert into public.teen_volunteer_profiles (user_id)
        values (p_user_id)
        on conflict (user_id) do nothing;
    end if;

    return normalized_roles;
end;
$$;

create function public.replace_teen_member_roles(
    p_user_id uuid,
    p_roles public.teen_member_role[]
)
returns public.teen_member_role[]
language sql
security invoker
set search_path = ''
as $$
    select private.replace_teen_member_roles($1, $2);
$$;

create function private.promote_account_to_admin(
    p_user_id uuid,
    p_access_level public.site_admin_level default 'admin'
)
returns public.site_admin_level
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    current_target_level public.site_admin_level;
begin
    if not private.is_super_administrator(current_user_id) then
        raise exception 'Super administrator access is required.' using errcode = '42501';
    end if;

    if not private.is_permanent_user(p_user_id) then
        raise exception 'Only an existing permanent account can become an administrator.'
            using errcode = 'P0001';
    end if;

    select access_level into current_target_level
    from public.admin_users
    where user_id = p_user_id
    for update;

    if p_user_id = current_user_id
       and current_target_level = 'super_admin'
       and p_access_level <> 'super_admin' then
        raise exception 'You cannot demote your own super administrator access.'
            using errcode = '42501';
    end if;

    if current_target_level = 'super_admin'
       and p_access_level <> 'super_admin'
       and (select count(*) from public.admin_users where access_level = 'super_admin') <= 1 then
        raise exception 'The final super administrator cannot be demoted.' using errcode = 'P0001';
    end if;

    insert into public.admin_users (user_id, access_level, granted_by)
    values (p_user_id, p_access_level, current_user_id)
    on conflict (user_id) do update
    set access_level = excluded.access_level, granted_by = excluded.granted_by;

    return p_access_level;
end;
$$;

create function public.promote_account_to_admin(
    p_user_id uuid,
    p_access_level public.site_admin_level default 'admin'
)
returns public.site_admin_level
language sql
security invoker
set search_path = ''
as $$
    select private.promote_account_to_admin($1, $2);
$$;

create function private.demote_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    target_level public.site_admin_level;
begin
    if not private.is_super_administrator(current_user_id) then
        raise exception 'Super administrator access is required.' using errcode = '42501';
    end if;

    if p_user_id = current_user_id then
        raise exception 'You cannot remove your own administrator access.' using errcode = '42501';
    end if;

    select access_level into target_level
    from public.admin_users
    where user_id = p_user_id
    for update;

    if target_level is null then
        raise exception 'Administrator could not be found.' using errcode = 'P0002';
    end if;

    if target_level = 'super_admin'
       and (select count(*) from public.admin_users where access_level = 'super_admin') <= 1 then
        raise exception 'The final super administrator cannot be removed.' using errcode = 'P0001';
    end if;

    delete from public.admin_users where user_id = p_user_id;
end;
$$;

create function public.demote_admin(p_user_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.demote_admin($1);
$$;

create function private.save_account_profile(
    p_user_id uuid,
    p_full_name text,
    p_contact_email text,
    p_contact_phone text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    current_user_id uuid := auth.uid();
    normalized_name text := btrim(coalesce(p_full_name, ''));
    normalized_email text := lower(btrim(coalesce(p_contact_email, '')));
    normalized_phone text := btrim(coalesce(p_contact_phone, ''));
begin
    if current_user_id <> p_user_id and not private.is_site_administrator(current_user_id) then
        raise exception 'You cannot update this account.' using errcode = '42501';
    end if;

    if char_length(normalized_name) not between 1 and 120
       or char_length(normalized_email) not between 3 and 320
       or char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Complete the account name, contact email, and phone.' using errcode = '22023';
    end if;

    update public.profiles
    set
        full_name = normalized_name,
        contact_email = normalized_email,
        contact_phone = normalized_phone
    where id = p_user_id;

    if not found then
        raise exception 'Account could not be found.' using errcode = 'P0002';
    end if;

    return p_user_id;
end;
$$;

create function public.save_account_profile(
    p_user_id uuid,
    p_full_name text,
    p_contact_email text,
    p_contact_phone text
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.save_account_profile($1, $2, $3, $4);
$$;

create function public.get_account_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'user_id', auth.uid(),
        'is_anonymous', private.is_anonymous_user(),
        'profile', (
            select jsonb_build_object(
                'full_name', profiles.full_name,
                'email', profiles.email,
                'contact_email', profiles.contact_email,
                'contact_phone', profiles.contact_phone,
                'account_type', profiles.account_type
            )
            from public.profiles
            where profiles.id = auth.uid()
        ),
        'admin_level', (
            select admin_users.access_level
            from public.admin_users
            where admin_users.user_id = auth.uid()
        ),
        'teen_roles', coalesce((
            select jsonb_agg(assignments.role order by assignments.role)
            from public.teen_member_role_assignments as assignments
            where assignments.user_id = auth.uid()
              and assignments.revoked_at is null
        ), '[]'::jsonb)
    );
$$;

create or replace function private.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_user_id uuid := auth.uid();
begin
    if account_user_id is null then
        raise exception 'You must be signed in to delete your account.' using errcode = '42501';
    end if;

    if private.is_site_administrator(account_user_id) then
        raise exception 'Remove administrator access from another super administrator before deleting this account.'
            using errcode = '42501';
    end if;

    delete from auth.users where id = account_user_id;

    if not found then
        raise exception 'Your account could not be found.' using errcode = 'P0002';
    end if;
end;
$$;

create policy "Super admins can view all administrators"
on public.admin_users
for select
to authenticated
using (private.is_super_administrator());

drop policy "Households can add saved members" on public.household_members;
create policy "Households and admins can add saved members"
on public.household_members
for insert
to authenticated
with check (
    (
        account_id = (select auth.uid())
        and exists (
            select 1 from public.profiles
            where profiles.id = (select auth.uid())
              and profiles.account_type = 'household'
        )
    )
    or private.is_site_administrator()
);

grant execute on function private.is_site_administrator(uuid) to anon, authenticated;
grant execute on function private.has_teen_member_role(public.teen_member_role, uuid) to anon, authenticated;
grant execute on function private.is_super_administrator(uuid) to authenticated;
grant execute on function private.is_permanent_user(uuid) to authenticated;

revoke execute on function private.is_anonymous_user(uuid) from public, anon, authenticated;
revoke execute on function private.ensure_household_registration() from public, anon, authenticated;
revoke execute on function private.parse_event_attendees(jsonb, uuid) from public, anon, authenticated;
revoke execute on function private.promote_event_waitlist(uuid) from public, anon, authenticated;
revoke execute on function private.register_for_event_v2(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke execute on function private.update_event_registration(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function private.cancel_event_registration(uuid) from public, anon, authenticated;
revoke execute on function private.claim_guest_registration(text) from public, anon, authenticated;
revoke execute on function private.complete_household_account(text, text) from public, anon, authenticated;
revoke execute on function private.save_event(uuid, jsonb) from public, anon, authenticated;
revoke execute on function private.delete_event_draft(uuid) from public, anon, authenticated;
revoke execute on function private.review_teen_member_application(uuid, text, text) from public, anon, authenticated;
revoke execute on function private.replace_teen_member_roles(uuid, public.teen_member_role[]) from public, anon, authenticated;
revoke execute on function private.promote_account_to_admin(uuid, public.site_admin_level) from public, anon, authenticated;
revoke execute on function private.demote_admin(uuid) from public, anon, authenticated;
revoke execute on function private.save_account_profile(uuid, text, text, text) from public, anon, authenticated;

revoke execute on function public.register_for_event(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.update_event_registration(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.cancel_event_registration(uuid) from public, anon, authenticated;
revoke execute on function public.claim_guest_registration(text) from public, anon, authenticated;
revoke execute on function public.complete_household_account(text, text) from public, anon, authenticated;
revoke execute on function public.save_event(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.delete_event_draft(uuid) from public, anon, authenticated;
revoke execute on function public.review_teen_member_application(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.replace_teen_member_roles(uuid, public.teen_member_role[]) from public, anon, authenticated;
revoke execute on function public.promote_account_to_admin(uuid, public.site_admin_level) from public, anon, authenticated;
revoke execute on function public.demote_admin(uuid) from public, anon, authenticated;
revoke execute on function public.save_account_profile(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_account_context() from public, anon, authenticated;

grant execute on function public.register_for_event(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.update_event_registration(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.cancel_event_registration(uuid) to authenticated;
grant execute on function public.claim_guest_registration(text) to authenticated;
grant execute on function public.complete_household_account(text, text) to authenticated;
grant execute on function public.save_event(uuid, jsonb) to authenticated;
grant execute on function public.delete_event_draft(uuid) to authenticated;
grant execute on function public.review_teen_member_application(uuid, text, text) to authenticated;
grant execute on function public.replace_teen_member_roles(uuid, public.teen_member_role[]) to authenticated;
grant execute on function public.promote_account_to_admin(uuid, public.site_admin_level) to authenticated;
grant execute on function public.demote_admin(uuid) to authenticated;
grant execute on function public.save_account_profile(uuid, text, text, text) to authenticated;
grant execute on function public.get_account_context() to authenticated;

grant update (full_name, contact_email, contact_phone) on public.profiles to authenticated;
grant update (full_name, contact_email, contact_phone) on public.account_profiles to authenticated;
grant insert (age, guardian_name, guardian_email, guardian_phone, guardian_consent)
on public.teen_member_applications to authenticated;
grant update (status, admin_notes) on public.teen_member_applications to authenticated;
grant insert (teen_member_user_id, event_id, role_title, instructions)
on public.event_volunteer_assignments to authenticated;
grant update (role_title, instructions, status)
on public.event_volunteer_assignments to authenticated;
grant insert (assignment_id, service_date, submitted_hours, description)
on public.volunteer_service_hours to authenticated;
grant update (status, approved_hours, admin_notes)
on public.volunteer_service_hours to authenticated;

comment on function public.register_for_event(uuid, jsonb, jsonb, text, text) is
    'Registers a signed-in household or CAPTCHA-protected anonymous guest atomically.';
comment on function public.update_event_registration(uuid, jsonb, jsonb) is
    'Safely edits an owned registration without risking already confirmed seats.';
comment on function public.cancel_event_registration(uuid) is
    'Cancels a registration and promotes strictly FIFO waitlisted groups while the event is locked.';
comment on function public.promote_account_to_admin(uuid, public.site_admin_level) is
    'Super-admin-only promotion of an existing permanent PCA account.';
