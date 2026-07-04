create type public.account_use as enum ('household', 'volunteer');
create type public.volunteer_application_status as enum ('pending', 'approved', 'rejected');
create type public.volunteer_assignment_status as enum ('assigned', 'completed', 'cancelled');
create type public.volunteer_hour_status as enum ('submitted', 'approved', 'rejected');

alter table public.profiles
    add column account_use public.account_use not null default 'household';

comment on column public.profiles.account_use is
    'The intended use of this Supabase Auth account. Existing accounts remain household accounts.';
comment on column public.profiles.full_name is
    'The account holder name shown in PCA dashboards and administrative records.';

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    profile_name text := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    requested_account_use text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'account_use', 'household')));
begin
    if new.email is null or char_length(btrim(new.email)) not between 3 and 320 then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if char_length(profile_name) not between 1 and 120 then
        raise exception 'Account holder full name must be between 1 and 120 characters.'
            using errcode = '22023';
    end if;

    if requested_account_use not in ('household', 'volunteer') then
        raise exception 'Choose a valid PCA account type.' using errcode = '22023';
    end if;

    insert into public.profiles (id, full_name, email, account_use)
    values (
        new.id,
        profile_name,
        btrim(new.email),
        requested_account_use::public.account_use
    );

    return new;
end;
$$;

create table public.volunteer_applications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null unique
        default auth.uid()
        references public.profiles (id) on delete cascade,
    age smallint not null
        check (age between 13 and 19),
    grade_level text not null
        check (grade_level in ('7', '8', '9', '10', '11', '12', 'Recent Graduate')),
    school_name text not null
        check (char_length(btrim(school_name)) between 1 and 200),
    phone text not null
        check (char_length(btrim(phone)) between 7 and 40),
    parent_guardian_name text not null
        check (char_length(btrim(parent_guardian_name)) between 1 and 120),
    parent_guardian_email text not null
        check (char_length(btrim(parent_guardian_email)) between 3 and 320),
    parent_guardian_phone text not null
        check (char_length(btrim(parent_guardian_phone)) between 7 and 40),
    interests text not null
        check (char_length(btrim(interests)) between 1 and 2000),
    experience text not null default ''
        check (char_length(experience) <= 2000),
    availability text not null
        check (char_length(btrim(availability)) between 1 and 2000),
    parent_guardian_consent boolean not null
        check (parent_guardian_consent = true),
    status public.volunteer_application_status not null default 'pending',
    admin_notes text not null default ''
        check (char_length(admin_notes) <= 4000),
    submitted_at timestamptz not null default now(),
    reviewed_by uuid references public.profiles (id) on delete set null,
    reviewed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint volunteer_application_review_shape check (
        (
            status = 'pending'
            and reviewed_by is null
            and reviewed_at is null
        )
        or
        (
            status in ('approved', 'rejected')
            and reviewed_by is not null
            and reviewed_at is not null
        )
    )
);

create index volunteer_applications_review_queue_idx
    on public.volunteer_applications (status, submitted_at, id);

create table public.volunteer_assignments (
    id uuid primary key default gen_random_uuid(),
    volunteer_user_id uuid not null
        references public.profiles (id) on delete cascade,
    event_id uuid not null
        references public.events (id) on delete restrict,
    role_title text not null
        check (char_length(btrim(role_title)) between 1 and 160),
    instructions text not null default ''
        check (char_length(instructions) <= 4000),
    status public.volunteer_assignment_status not null default 'assigned',
    assigned_by uuid not null default auth.uid()
        references public.profiles (id) on delete restrict,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint volunteer_assignments_one_per_event unique (volunteer_user_id, event_id)
);

create index volunteer_assignments_event_idx
    on public.volunteer_assignments (event_id, status, volunteer_user_id);
create index volunteer_assignments_volunteer_idx
    on public.volunteer_assignments (volunteer_user_id, status, created_at desc);

create table public.volunteer_hours (
    id uuid primary key default gen_random_uuid(),
    volunteer_user_id uuid not null default auth.uid()
        references public.profiles (id) on delete cascade,
    assignment_id uuid not null
        references public.volunteer_assignments (id) on delete restrict,
    service_date date not null
        check (service_date <= current_date),
    submitted_hours numeric(5, 2) not null
        check (submitted_hours between 0.25 and 24),
    description text not null
        check (char_length(btrim(description)) between 1 and 2000),
    status public.volunteer_hour_status not null default 'submitted',
    approved_hours numeric(5, 2),
    admin_notes text not null default ''
        check (char_length(admin_notes) <= 4000),
    submitted_at timestamptz not null default now(),
    reviewed_by uuid references public.profiles (id) on delete set null,
    reviewed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint volunteer_hours_review_shape check (
        (
            status = 'submitted'
            and approved_hours is null
            and reviewed_by is null
            and reviewed_at is null
        )
        or
        (
            status = 'approved'
            and approved_hours between 0.25 and submitted_hours
            and reviewed_by is not null
            and reviewed_at is not null
        )
        or
        (
            status = 'rejected'
            and approved_hours is null
            and reviewed_by is not null
            and reviewed_at is not null
        )
    )
);

create index volunteer_hours_volunteer_idx
    on public.volunteer_hours (volunteer_user_id, service_date desc, submitted_at desc);
create index volunteer_hours_review_queue_idx
    on public.volunteer_hours (status, submitted_at, id);
create index volunteer_hours_assignment_idx
    on public.volunteer_hours (assignment_id, service_date desc);

create trigger volunteer_applications_set_updated_at
before update on public.volunteer_applications
for each row execute function private.set_updated_at();

create trigger volunteer_assignments_set_updated_at
before update on public.volunteer_assignments
for each row execute function private.set_updated_at();

create trigger volunteer_hours_set_updated_at
before update on public.volunteer_hours
for each row execute function private.set_updated_at();

create function private.set_volunteer_application_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.status is distinct from old.status then
        if new.status = 'pending' then
            new.reviewed_by := null;
            new.reviewed_at := null;
        else
            new.reviewed_by := auth.uid();
            new.reviewed_at := now();
        end if;
    end if;

    return new;
end;
$$;

create trigger volunteer_applications_set_review
before update of status on public.volunteer_applications
for each row execute function private.set_volunteer_application_review();

create function private.set_volunteer_hour_review()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if new.status is distinct from old.status then
        if new.status = 'submitted' then
            new.approved_hours := null;
            new.reviewed_by := null;
            new.reviewed_at := null;
        else
            new.reviewed_by := auth.uid();
            new.reviewed_at := now();

            if new.status = 'rejected' then
                new.approved_hours := null;
            end if;
        end if;
    end if;

    return new;
end;
$$;

create trigger volunteer_hours_set_review
before update of status on public.volunteer_hours
for each row execute function private.set_volunteer_hour_review();

create function private.ensure_household_registration()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if not exists (
        select 1
        from public.profiles
        where profiles.id = new.account_id
          and profiles.account_use = 'household'
    ) then
        raise exception 'Event attendee registration requires a household account.'
            using errcode = '42501';
    end if;

    return new;
end;
$$;

create trigger registrations_require_household_account
before insert on public.registrations
for each row execute function private.ensure_household_registration();

alter table public.volunteer_applications enable row level security;
alter table public.volunteer_assignments enable row level security;
alter table public.volunteer_hours enable row level security;

create policy "Volunteers and admins can view applications"
on public.volunteer_applications
for select
to authenticated
using (
    user_id = (select auth.uid())
    or exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Volunteer accounts can submit applications"
on public.volunteer_applications
for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and status = 'pending'
    and reviewed_by is null
    and reviewed_at is null
    and exists (
        select 1
        from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.account_use = 'volunteer'
    )
);

create policy "Admins can review volunteer applications"
on public.volunteer_applications
for update
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Volunteers and admins can view assignments"
on public.volunteer_assignments
for select
to authenticated
using (
    volunteer_user_id = (select auth.uid())
    or exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Admins can assign approved volunteers"
on public.volunteer_assignments
for insert
to authenticated
with check (
    assigned_by = (select auth.uid())
    and exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
    and exists (
        select 1
        from public.volunteer_applications
        where volunteer_applications.user_id = volunteer_user_id
          and volunteer_applications.status = 'approved'
    )
);

create policy "Admins can update volunteer assignments"
on public.volunteer_assignments
for update
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Admins can delete volunteer assignments"
on public.volunteer_assignments
for delete
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Volunteers and admins can view hours"
on public.volunteer_hours
for select
to authenticated
using (
    volunteer_user_id = (select auth.uid())
    or exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

create policy "Approved volunteers can submit assigned hours"
on public.volunteer_hours
for insert
to authenticated
with check (
    volunteer_user_id = (select auth.uid())
    and status = 'submitted'
    and approved_hours is null
    and reviewed_by is null
    and reviewed_at is null
    and exists (
        select 1
        from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.account_use = 'volunteer'
    )
    and exists (
        select 1
        from public.volunteer_applications
        where volunteer_applications.user_id = (select auth.uid())
          and volunteer_applications.status = 'approved'
    )
    and exists (
        select 1
        from public.volunteer_assignments
        where volunteer_assignments.id = assignment_id
          and volunteer_assignments.volunteer_user_id = (select auth.uid())
          and volunteer_assignments.status <> 'cancelled'
    )
);

create policy "Admins can review volunteer hours"
on public.volunteer_hours
for update
to authenticated
using (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
)
with check (
    exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

drop policy "Authenticated users can view available registered or admin events"
on public.events;

create policy "Authenticated users can view available registered assigned or admin events"
on public.events
for select
to authenticated
using (
    published = true
    or exists (
        select 1
        from public.registrations
        where registrations.event_id = events.id
          and registrations.account_id = (select auth.uid())
    )
    or exists (
        select 1
        from public.volunteer_assignments
        where volunteer_assignments.event_id = events.id
          and volunteer_assignments.volunteer_user_id = (select auth.uid())
    )
    or exists (
        select 1
        from public.admin_users
        where admin_users.user_id = (select auth.uid())
    )
);

revoke all on table public.volunteer_applications from anon, authenticated;
revoke all on table public.volunteer_assignments from anon, authenticated;
revoke all on table public.volunteer_hours from anon, authenticated;

grant select on table public.volunteer_applications to authenticated;
grant insert (
    age,
    grade_level,
    school_name,
    phone,
    parent_guardian_name,
    parent_guardian_email,
    parent_guardian_phone,
    interests,
    experience,
    availability,
    parent_guardian_consent
) on table public.volunteer_applications to authenticated;
grant update (status, admin_notes)
on table public.volunteer_applications to authenticated;

grant select on table public.volunteer_assignments to authenticated;
grant insert (volunteer_user_id, event_id, role_title, instructions)
on table public.volunteer_assignments to authenticated;
grant update (role_title, instructions, status)
on table public.volunteer_assignments to authenticated;
grant delete on table public.volunteer_assignments to authenticated;

grant select on table public.volunteer_hours to authenticated;
grant insert (assignment_id, service_date, submitted_hours, description)
on table public.volunteer_hours to authenticated;
grant update (status, approved_hours, admin_notes)
on table public.volunteer_hours to authenticated;

revoke execute on function private.set_volunteer_application_review()
from public, anon, authenticated;
revoke execute on function private.set_volunteer_hour_review()
from public, anon, authenticated;
revoke execute on function private.ensure_household_registration()
from public, anon, authenticated;

comment on table public.volunteer_applications is
    'Teen volunteer applications submitted by dedicated volunteer-use Supabase Auth accounts.';
comment on table public.volunteer_assignments is
    'Administrator-created event assignments for approved volunteers.';
comment on table public.volunteer_hours is
    'Volunteer-submitted service hours with administrator approval tracking.';
