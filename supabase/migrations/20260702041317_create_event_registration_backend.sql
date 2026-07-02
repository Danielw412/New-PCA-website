create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create type public.registration_status as enum ('confirmed', 'waitlisted');

create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    full_name text not null
        check (char_length(btrim(full_name)) between 1 and 120),
    email text not null
        check (char_length(btrim(email)) between 3 and 320),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_idx
    on public.profiles (lower(email));

create table public.admin_users (
    user_id uuid primary key references auth.users (id) on delete cascade,
    created_at timestamptz not null default now()
);

create table public.events (
    id uuid primary key default gen_random_uuid(),
    title text not null
        check (char_length(btrim(title)) between 1 and 160),
    description text not null default ''
        check (char_length(description) <= 5000),
    location text not null
        check (char_length(btrim(location)) between 1 and 240),
    starts_at timestamptz not null,
    ends_at timestamptz not null,
    capacity integer not null
        check (capacity > 0),
    max_participants_per_registration integer not null default 6
        check (max_participants_per_registration > 0),
    registration_open boolean not null default true,
    published boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint events_end_after_start check (ends_at > starts_at),
    constraint events_group_limit_within_capacity
        check (max_participants_per_registration <= capacity)
);

create index events_public_schedule_idx
    on public.events (starts_at)
    where published = true;

create table public.registrations (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events (id) on delete restrict,
    account_id uuid not null references public.profiles (id) on delete cascade,
    status public.registration_status not null,
    participant_count integer not null
        check (participant_count > 0),
    created_at timestamptz not null default now(),
    constraint registrations_one_group_per_event
        unique (event_id, account_id)
);

create index registrations_event_queue_idx
    on public.registrations (event_id, status, created_at, id);

create index registrations_account_idx
    on public.registrations (account_id, created_at desc);

create table public.registration_participants (
    id uuid primary key default gen_random_uuid(),
    registration_id uuid not null
        references public.registrations (id) on delete cascade,
    position integer not null
        check (position > 0),
    full_name text not null
        check (char_length(btrim(full_name)) between 1 and 120),
    grade text not null
        check (
            grade in (
                'Pre-K', 'K',
                '1', '2', '3', '4', '5', '6',
                '7', '8', '9', '10', '11', '12',
                'College', 'Adult', 'Not Applicable'
            )
        ),
    created_at timestamptz not null default now(),
    constraint registration_participants_position_unique
        unique (registration_id, position)
);

create index registration_participants_registration_idx
    on public.registration_participants (registration_id, position);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger events_set_updated_at
before update on public.events
for each row execute function private.set_updated_at();

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
        raise exception 'Account holder full name must be between 1 and 120 characters.'
            using errcode = '22023';
    end if;

    insert into public.profiles (id, full_name, email)
    values (new.id, profile_name, btrim(new.email));

    return new;
end;
$$;

create trigger create_profile_after_signup
after insert on auth.users
for each row execute function private.handle_new_user();

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    if new.email is not null and new.email is distinct from old.email then
        update public.profiles
        set email = btrim(new.email)
        where id = new.id;
    end if;

    return new;
end;
$$;

create trigger sync_profile_after_email_change
after update of email on auth.users
for each row execute function private.sync_profile_email();

insert into public.profiles (id, full_name, email)
select
    users.id,
    left(
        coalesce(
            nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
            split_part(users.email, '@', 1)
        ),
        120
    ),
    btrim(users.email)
from auth.users as users
where users.email is not null
on conflict (id) do nothing;

create or replace function private.register_for_event(
    p_event_id uuid,
    p_participants jsonb
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
    participant_grade text;
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
        raise exception 'Your account profile could not be found.'
            using errcode = 'P0002';
    end if;

    if p_participants is null or jsonb_typeof(p_participants) <> 'array' then
        raise exception 'Participants must be supplied as a list.'
            using errcode = '22023';
    end if;

    requested_count := jsonb_array_length(p_participants);

    if requested_count < 1 then
        raise exception 'Add at least one participant.'
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
        raise exception 'This event allows at most % participants per account.',
            event_record.max_participants_per_registration
            using errcode = '22023';
    end if;

    if exists (
        select 1
        from public.registrations
        where event_id = p_event_id
          and account_id = account_user_id
    ) then
        raise exception 'This account is already registered for the event.'
            using errcode = '23505';
    end if;

    for participant_record in
        select participant.value, participant.ordinality
        from jsonb_array_elements(p_participants) with ordinality as participant(value, ordinality)
    loop
        if jsonb_typeof(participant_record.value) <> 'object' then
            raise exception 'Each participant must include a name and grade.'
                using errcode = '22023';
        end if;

        participant_name := btrim(coalesce(participant_record.value ->> 'full_name', ''));
        participant_grade := coalesce(participant_record.value ->> 'grade', '');

        if char_length(participant_name) not between 1 and 120 then
            raise exception 'Participant names must be between 1 and 120 characters.'
                using errcode = '22023';
        end if;

        if participant_grade not in (
            'Pre-K', 'K',
            '1', '2', '3', '4', '5', '6',
            '7', '8', '9', '10', '11', '12',
            'College', 'Adult', 'Not Applicable'
        ) then
            raise exception 'Select a valid grade for every participant.'
                using errcode = '22023';
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
        participant_count
    )
    values (
        p_event_id,
        account_user_id,
        assigned_status,
        requested_count
    )
    returning id into new_registration_id;

    insert into public.registration_participants (
        registration_id,
        position,
        full_name,
        grade
    )
    select
        new_registration_id,
        participant.ordinality::integer,
        btrim(participant.value ->> 'full_name'),
        participant.value ->> 'grade'
    from jsonb_array_elements(p_participants) with ordinality as participant(value, ordinality);

    return query
    select new_registration_id, assigned_status, requested_count;
end;
$$;

create or replace function public.register_for_event(
    p_event_id uuid,
    p_participants jsonb
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
    from private.register_for_event($1, $2);
$$;

alter table public.profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.events enable row level security;
alter table public.registrations enable row level security;
alter table public.registration_participants enable row level security;

create policy "Users can view their profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Admins can view profiles"
on public.profiles
for select
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

create policy "Users can check their admin membership"
on public.admin_users
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "Anyone can view published events"
on public.events
for select
to anon, authenticated
using (published = true);

create policy "Admins can view all events"
on public.events
for select
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

create policy "Users can view their registrations"
on public.registrations
for select
to authenticated
using (account_id = (select auth.uid()));

create policy "Admins can view all registrations"
on public.registrations
for select
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

create policy "Users can view their participants"
on public.registration_participants
for select
to authenticated
using (
    exists (
        select 1
        from public.registrations
        where registrations.id = registration_id
          and registrations.account_id = (select auth.uid())
    )
);

create policy "Admins can view all participants"
on public.registration_participants
for select
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where user_id = (select auth.uid())
    )
);

revoke all on table public.profiles from anon, authenticated;
revoke all on table public.admin_users from anon, authenticated;
revoke all on table public.events from anon, authenticated;
revoke all on table public.registrations from anon, authenticated;
revoke all on table public.registration_participants from anon, authenticated;

grant select on table public.events to anon, authenticated;
grant select on table public.profiles to authenticated;
grant select on table public.admin_users to authenticated;
grant select on table public.registrations to authenticated;
grant select on table public.registration_participants to authenticated;

revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.sync_profile_email() from public, anon, authenticated;
revoke execute on function private.register_for_event(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.register_for_event(uuid, jsonb) from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.register_for_event(uuid, jsonb) to authenticated;
grant execute on function public.register_for_event(uuid, jsonb) to authenticated;

comment on table public.admin_users is
    'Administrators are promoted manually by inserting their Auth user ID in the Supabase dashboard.';

comment on function public.register_for_event(uuid, jsonb) is
    'Registers the signed-in account for an event. Capacity and status are assigned atomically by the database.';
