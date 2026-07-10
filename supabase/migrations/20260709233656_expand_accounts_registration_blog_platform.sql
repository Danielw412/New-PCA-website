-- Expand phase for the PCA accounts, registration, administration, and blog
-- upgrade. Existing physical table names remain in place during deployment so
-- the currently published frontend keeps working. Canonical security-invoker
-- views expose the new API names until a post-deployment contract migration.

create type public.account_type as enum ('household', 'teen_member');
create type public.site_admin_level as enum ('admin', 'super_admin');
create type public.teen_member_role as enum ('student_council', 'editor', 'volunteer');
create type public.blog_post_status as enum ('draft', 'published');

-- This value is consumed by functions created in the following migration. It
-- must be committed before PostgreSQL permits those functions to use it.
alter type public.registration_status add value if not exists 'cancelled';

alter table public.profiles
    add column account_type public.account_type,
    add column contact_email text,
    add column contact_phone text,
    add constraint profiles_contact_email_valid check (
        contact_email is null
        or char_length(btrim(contact_email)) between 3 and 320
    ),
    add constraint profiles_contact_phone_valid check (
        contact_phone is null
        or char_length(btrim(contact_phone)) between 7 and 40
    );

update public.profiles
set
    account_type = case
        when account_use = 'volunteer' then 'teen_member'::public.account_type
        else 'household'::public.account_type
    end,
    contact_email = coalesce(contact_email, email);

alter table public.profiles
    alter column account_type set not null,
    alter column account_type set default 'household';

create function private.sync_account_type_columns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    if tg_op = 'INSERT' then
        if new.account_use = 'volunteer' then
            new.account_type := 'teen_member'::public.account_type;
        elsif new.account_type is null then
            new.account_type := 'household'::public.account_type;
        end if;
    elsif new.account_type is distinct from old.account_type then
        new.account_use := case new.account_type
            when 'teen_member'::public.account_type then 'volunteer'::public.account_use
            else 'household'::public.account_use
        end;
    elsif new.account_use is distinct from old.account_use then
        new.account_type := case new.account_use
            when 'volunteer'::public.account_use then 'teen_member'::public.account_type
            else 'household'::public.account_type
        end;
    end if;

    if new.contact_email is null then
        new.contact_email := new.email;
    end if;

    return new;
end;
$$;

create trigger profiles_sync_account_type_columns
before insert or update of account_type, account_use, email, contact_email
on public.profiles
for each row execute function private.sync_account_type_columns();

alter table public.admin_users
    add column access_level public.site_admin_level not null default 'admin',
    add column granted_by uuid references auth.users (id) on delete set null;

update public.admin_users as administrators
set access_level = 'super_admin'
where administrators.user_id = (
    select profiles.id
    from public.profiles as profiles
    join public.admin_users as existing_admin
      on existing_admin.user_id = profiles.id
    where lower(btrim(profiles.full_name)) = 'daniel wang'
    order by existing_admin.created_at, profiles.id
    limit 1
);

alter table public.registrations
    drop constraint registrations_account_id_fkey,
    alter column account_id drop not null,
    add constraint registrations_account_id_fkey
        foreign key (account_id) references auth.users (id) on delete set null,
    add column registration_source text not null default 'household',
    add column contact_name text,
    add column contact_email text,
    add column contact_phone text,
    add column updated_at timestamptz not null default now(),
    add column cancelled_at timestamptz,
    add constraint registrations_source_valid check (
        registration_source in ('household', 'guest')
    ),
    add constraint registrations_contact_name_valid check (
        contact_name is null
        or char_length(btrim(contact_name)) between 1 and 120
    ),
    add constraint registrations_contact_email_valid check (
        contact_email is null
        or char_length(btrim(contact_email)) between 3 and 320
    ),
    add constraint registrations_contact_phone_valid check (
        contact_phone is null
        or char_length(btrim(contact_phone)) between 7 and 40
    );

update public.registrations as registrations
set
    contact_name = profiles.full_name,
    contact_email = coalesce(profiles.contact_email, profiles.email),
    contact_phone = profiles.contact_phone
from public.profiles as profiles
where profiles.id = registrations.account_id;

create trigger registrations_set_updated_at
before update on public.registrations
for each row execute function private.set_updated_at();

create table public.household_members (
    id uuid primary key default gen_random_uuid(),
    account_id uuid not null references public.profiles (id) on delete cascade,
    full_name text not null
        check (char_length(btrim(full_name)) between 1 and 120),
    attendee_type text not null
        check (attendee_type in ('child', 'adult')),
    age smallint,
    school_district text,
    grade text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint household_members_record_shape_valid check (
        (
            attendee_type = 'child'
            and age between 0 and 25
            and char_length(btrim(coalesce(school_district, ''))) between 1 and 160
            and grade is null
        )
        or
        (
            attendee_type = 'adult'
            and age is null
            and school_district is null
            and grade is null
        )
        or
        (
            grade is not null
            and attendee_type in ('child', 'adult')
            and age is null
            and school_district is null
        )
    )
);

create index household_members_account_idx
    on public.household_members (account_id, created_at, id);

create trigger household_members_set_updated_at
before update on public.household_members
for each row execute function private.set_updated_at();

alter table public.registration_participants
    add column household_member_id uuid
        references public.household_members (id) on delete set null;

-- Teen applications now collect only identity and guardian consent. Existing
-- role-specific volunteer fields remain available for migration and legacy UI.
alter table public.volunteer_applications
    drop constraint volunteer_applications_grade_level_check,
    drop constraint volunteer_applications_school_name_check,
    drop constraint volunteer_applications_phone_check,
    drop constraint volunteer_applications_interests_check,
    drop constraint volunteer_applications_availability_check,
    alter column grade_level drop not null,
    alter column school_name drop not null,
    alter column phone drop not null,
    alter column interests drop not null,
    alter column availability drop not null,
    add constraint teen_application_grade_level_valid check (
        grade_level is null
        or grade_level in ('7', '8', '9', '10', '11', '12', 'Recent Graduate')
    ),
    add constraint teen_application_school_name_valid check (
        school_name is null
        or char_length(btrim(school_name)) between 1 and 200
    ),
    add constraint teen_application_phone_valid check (
        phone is null
        or char_length(btrim(phone)) between 7 and 40
    ),
    add constraint teen_application_interests_valid check (
        interests is null
        or char_length(btrim(interests)) between 1 and 2000
    ),
    add constraint teen_application_availability_valid check (
        availability is null
        or char_length(btrim(availability)) between 1 and 2000
    );

create table public.teen_member_role_assignments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    role public.teen_member_role not null,
    assigned_by uuid references auth.users (id) on delete set null,
    assigned_at timestamptz not null default now(),
    revoked_by uuid references auth.users (id) on delete set null,
    revoked_at timestamptz,
    constraint teen_member_role_revocation_shape check (
        (revoked_at is null and revoked_by is null)
        or revoked_at is not null
    )
);

create unique index teen_member_active_role_unique
    on public.teen_member_role_assignments (user_id, role)
    where revoked_at is null;
create index teen_member_role_lookup_idx
    on public.teen_member_role_assignments (role, user_id)
    where revoked_at is null;

create table public.teen_volunteer_profiles (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    grade_level text
        check (grade_level is null or grade_level in ('7', '8', '9', '10', '11', '12', 'Recent Graduate')),
    school_name text
        check (school_name is null or char_length(btrim(school_name)) between 1 and 200),
    phone text
        check (phone is null or char_length(btrim(phone)) between 7 and 40),
    interests text not null default '' check (char_length(interests) <= 2000),
    experience text not null default '' check (char_length(experience) <= 2000),
    availability text not null default '' check (char_length(availability) <= 2000),
    setup_completed_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger teen_volunteer_profiles_set_updated_at
before update on public.teen_volunteer_profiles
for each row execute function private.set_updated_at();

insert into public.teen_volunteer_profiles (
    user_id,
    grade_level,
    school_name,
    phone,
    interests,
    experience,
    availability,
    setup_completed_at,
    created_at,
    updated_at
)
select
    applications.user_id,
    applications.grade_level,
    applications.school_name,
    applications.phone,
    coalesce(applications.interests, ''),
    applications.experience,
    coalesce(applications.availability, ''),
    case
        when applications.grade_level is not null
         and applications.school_name is not null
         and applications.phone is not null
         and applications.interests is not null
         and applications.availability is not null
            then applications.updated_at
        else null
    end,
    applications.submitted_at,
    applications.updated_at
from public.volunteer_applications as applications
on conflict (user_id) do nothing;

insert into public.teen_member_role_assignments (user_id, role, assigned_by, assigned_at)
select
    applications.user_id,
    'volunteer'::public.teen_member_role,
    applications.reviewed_by,
    coalesce(applications.reviewed_at, applications.updated_at)
from public.volunteer_applications as applications
where applications.status = 'approved'
on conflict (user_id, role) where revoked_at is null do nothing;

create table public.guest_registration_claims (
    id uuid primary key default gen_random_uuid(),
    registration_id uuid not null unique
        references public.registrations (id) on delete cascade,
    token_hash bytea not null unique,
    intended_email text not null
        check (char_length(btrim(intended_email)) between 3 and 320),
    expires_at timestamptz not null,
    claimed_by uuid references auth.users (id) on delete set null,
    claimed_at timestamptz,
    created_at timestamptz not null default now(),
    constraint guest_claim_expiry_valid check (expires_at > created_at),
    constraint guest_claim_completion_shape check (
        (claimed_at is null and claimed_by is null)
        or (claimed_at is not null and claimed_by is not null)
    )
);

create index guest_registration_claims_expiry_idx
    on public.guest_registration_claims (expires_at)
    where claimed_at is null;

create function private.blog_content_is_valid(content jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
    block jsonb;
    block_type text;
    block_source text;
    block_path text;
begin
    if content is null
       or jsonb_typeof(content) <> 'array'
       or jsonb_array_length(content) < 1
       or jsonb_array_length(content) > 80 then
        return false;
    end if;

    for block in select value from jsonb_array_elements(content)
    loop
        if jsonb_typeof(block) <> 'object' then
            return false;
        end if;

        block_type := block ->> 'type';

        if block_type = 'heading' then
            if (block ->> 'level') not in ('2', '3')
               or char_length(btrim(coalesce(block ->> 'text', ''))) not between 1 and 180 then
                return false;
            end if;
        elsif block_type in ('paragraph', 'quote') then
            if char_length(btrim(coalesce(block ->> 'text', ''))) not between 1 and 5000 then
                return false;
            end if;
        elsif block_type = 'image' then
            block_source := block ->> 'source';
            block_path := block ->> 'path';

            if block_source not in ('local', 'storage')
               or char_length(btrim(coalesce(block ->> 'alt', ''))) not between 1 and 240
               or char_length(coalesce(block_path, '')) not between 1 and 500
               or block_path like '%..%'
               or block_path like '%\\%'
               or block_path like '%:%' then
                return false;
            end if;

            if block_source = 'local' and block_path !~ '^images/[A-Za-z0-9._/-]+$' then
                return false;
            end if;

            if block_source = 'storage'
               and block_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9._/-]+$' then
                return false;
            end if;
        else
            return false;
        end if;
    end loop;

    return true;
end;
$$;

create table public.blog_posts (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique
        check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and char_length(slug) between 3 and 120),
    title text not null
        check (char_length(btrim(title)) between 1 and 180),
    excerpt text not null
        check (char_length(btrim(excerpt)) between 1 and 600),
    content_version smallint not null default 1 check (content_version = 1),
    content jsonb not null check (private.blog_content_is_valid(content)),
    cover_image_source text
        check (cover_image_source is null or cover_image_source in ('local', 'storage')),
    cover_image_path text,
    cover_image_alt text,
    status public.blog_post_status not null default 'draft',
    author_user_id uuid references auth.users (id) on delete set null,
    author_display_name text not null
        check (char_length(btrim(author_display_name)) between 1 and 120),
    published_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint blog_posts_cover_shape check (
        (
            cover_image_source is null
            and cover_image_path is null
            and cover_image_alt is null
        )
        or
        (
            cover_image_source is not null
            and char_length(cover_image_path) between 1 and 500
            and char_length(btrim(cover_image_alt)) between 1 and 240
            and cover_image_path not like '%..%'
            and cover_image_path not like '%\\%'
            and cover_image_path not like '%:%'
            and (
                (cover_image_source = 'local' and cover_image_path ~ '^images/[A-Za-z0-9._/-]+$')
                or
                (
                    cover_image_source = 'storage'
                    and cover_image_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9._/-]+$'
                )
            )
        )
    ),
    constraint blog_posts_publish_shape check (
        (status = 'draft' and published_at is null)
        or (status = 'published' and published_at is not null)
    )
);

create index blog_posts_public_feed_idx
    on public.blog_posts (published_at desc, id)
    where status = 'published';
create index blog_posts_author_idx
    on public.blog_posts (author_user_id, updated_at desc);

create trigger blog_posts_set_updated_at
before update on public.blog_posts
for each row execute function private.set_updated_at();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'blog-media',
    'blog-media',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Locked-down authorization helpers. Browser-facing policies and RPCs call
-- these instead of repeating mutable metadata checks.
create function private.is_site_administrator(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select check_user_id is not null and exists (
        select 1
        from public.admin_users
        where admin_users.user_id = check_user_id
    );
$$;

create function private.is_super_administrator(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select check_user_id is not null and exists (
        select 1
        from public.admin_users
        where admin_users.user_id = check_user_id
          and admin_users.access_level = 'super_admin'
    );
$$;

create function private.has_teen_member_role(
    requested_role public.teen_member_role,
    check_user_id uuid default auth.uid()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select check_user_id is not null and exists (
        select 1
        from public.teen_member_role_assignments
        where teen_member_role_assignments.user_id = check_user_id
          and teen_member_role_assignments.role = requested_role
          and teen_member_role_assignments.revoked_at is null
    );
$$;

create function private.is_permanent_user(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select check_user_id is not null and exists (
        select 1
        from public.profiles
        where profiles.id = check_user_id
    );
$$;

revoke execute on function private.sync_account_type_columns() from public, anon, authenticated;
revoke execute on function private.blog_content_is_valid(jsonb) from public, anon, authenticated;
revoke execute on function private.is_site_administrator(uuid) from public, anon, authenticated;
revoke execute on function private.is_super_administrator(uuid) from public, anon, authenticated;
revoke execute on function private.has_teen_member_role(public.teen_member_role, uuid) from public, anon, authenticated;
revoke execute on function private.is_permanent_user(uuid) from public, anon, authenticated;

-- Anonymous Auth identities intentionally receive no permanent account row.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    profile_name text;
    requested_account_type text;
    legacy_account_use text;
begin
    if coalesce(new.is_anonymous, false) then
        return new;
    end if;

    profile_name := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
    requested_account_type := lower(btrim(coalesce(new.raw_user_meta_data ->> 'account_type', '')));
    legacy_account_use := lower(btrim(coalesce(new.raw_user_meta_data ->> 'account_use', '')));

    if new.email is null or char_length(btrim(new.email)) not between 3 and 320 then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if char_length(profile_name) not between 1 and 120 then
        raise exception 'Account holder full name must be between 1 and 120 characters.'
            using errcode = '22023';
    end if;

    if requested_account_type = '' then
        requested_account_type := case legacy_account_use
            when 'volunteer' then 'teen_member'
            else 'household'
        end;
    end if;

    if requested_account_type not in ('household', 'teen_member') then
        raise exception 'Choose a valid PCA account type.' using errcode = '22023';
    end if;

    insert into public.profiles (
        id,
        full_name,
        email,
        contact_email,
        account_type,
        account_use
    )
    values (
        new.id,
        profile_name,
        btrim(new.email),
        btrim(new.email),
        requested_account_type::public.account_type,
        case requested_account_type
            when 'teen_member' then 'volunteer'::public.account_use
            else 'household'::public.account_use
        end
    );

    return new;
end;
$$;

-- Canonical API names used by the new frontend during the expand phase.
create view public.account_profiles
with (security_invoker = true)
as
select
    profiles.id,
    profiles.full_name,
    profiles.email,
    profiles.contact_email,
    profiles.contact_phone,
    profiles.account_type,
    profiles.created_at,
    profiles.updated_at
from public.profiles;

create view public.site_administrators
with (security_invoker = true)
as
select
    admin_users.user_id,
    admin_users.access_level,
    admin_users.created_at as granted_at,
    admin_users.granted_by
from public.admin_users;

create view public.event_registrations
with (security_invoker = true)
as
select
    registrations.id,
    registrations.event_id,
    registrations.account_id as owner_user_id,
    registrations.registration_source,
    registrations.contact_name,
    registrations.contact_email,
    registrations.contact_phone,
    registrations.status,
    registrations.participant_count,
    registrations.referral_source,
    registrations.referral_source_other,
    registrations.created_at,
    registrations.updated_at,
    registrations.cancelled_at
from public.registrations;

create view public.event_registration_attendees
with (security_invoker = true)
as
select
    registration_participants.id,
    registration_participants.registration_id,
    registration_participants.household_member_id,
    registration_participants.position,
    registration_participants.full_name,
    registration_participants.grade,
    registration_participants.attendee_type,
    registration_participants.age,
    registration_participants.school_district,
    registration_participants.created_at
from public.registration_participants;

create view public.teen_member_applications
with (security_invoker = true)
as
select
    volunteer_applications.id,
    volunteer_applications.user_id,
    volunteer_applications.age,
    volunteer_applications.parent_guardian_name as guardian_name,
    volunteer_applications.parent_guardian_email as guardian_email,
    volunteer_applications.parent_guardian_phone as guardian_phone,
    volunteer_applications.parent_guardian_consent as guardian_consent,
    volunteer_applications.status,
    volunteer_applications.admin_notes,
    volunteer_applications.submitted_at,
    volunteer_applications.reviewed_by,
    volunteer_applications.reviewed_at,
    volunteer_applications.updated_at
from public.volunteer_applications;

create view public.event_volunteer_assignments
with (security_invoker = true)
as
select
    volunteer_assignments.id,
    volunteer_assignments.volunteer_user_id as teen_member_user_id,
    volunteer_assignments.event_id,
    volunteer_assignments.role_title,
    volunteer_assignments.instructions,
    volunteer_assignments.status,
    volunteer_assignments.assigned_by,
    volunteer_assignments.created_at,
    volunteer_assignments.updated_at
from public.volunteer_assignments;

create view public.volunteer_service_hours
with (security_invoker = true)
as
select
    volunteer_hours.id,
    volunteer_hours.volunteer_user_id as teen_member_user_id,
    volunteer_hours.assignment_id,
    volunteer_hours.service_date,
    volunteer_hours.submitted_hours,
    volunteer_hours.description,
    volunteer_hours.status,
    volunteer_hours.approved_hours,
    volunteer_hours.admin_notes,
    volunteer_hours.submitted_at,
    volunteer_hours.reviewed_by,
    volunteer_hours.reviewed_at,
    volunteer_hours.updated_at
from public.volunteer_hours;

alter table public.household_members enable row level security;
alter table public.teen_member_role_assignments enable row level security;
alter table public.teen_volunteer_profiles enable row level security;
alter table public.guest_registration_claims enable row level security;
alter table public.blog_posts enable row level security;

create policy "Households and admins can view saved members"
on public.household_members
for select
to authenticated
using (
    account_id = (select auth.uid())
    or private.is_site_administrator()
);

create policy "Households can add saved members"
on public.household_members
for insert
to authenticated
with check (
    account_id = (select auth.uid())
    and exists (
        select 1 from public.profiles
        where profiles.id = (select auth.uid())
          and profiles.account_type = 'household'
    )
);

create policy "Households and admins can update saved members"
on public.household_members
for update
to authenticated
using (account_id = (select auth.uid()) or private.is_site_administrator())
with check (account_id = (select auth.uid()) or private.is_site_administrator());

create policy "Households and admins can delete saved members"
on public.household_members
for delete
to authenticated
using (account_id = (select auth.uid()) or private.is_site_administrator());

create policy "Teen members and admins can view role assignments"
on public.teen_member_role_assignments
for select
to authenticated
using (user_id = (select auth.uid()) or private.is_site_administrator());

create policy "Volunteers and admins can view volunteer profiles"
on public.teen_volunteer_profiles
for select
to authenticated
using (user_id = (select auth.uid()) or private.is_site_administrator());

create policy "Assigned volunteers can create their volunteer profile"
on public.teen_volunteer_profiles
for insert
to authenticated
with check (
    user_id = (select auth.uid())
    and private.has_teen_member_role('volunteer')
);

create policy "Assigned volunteers and admins can update volunteer profiles"
on public.teen_volunteer_profiles
for update
to authenticated
using (
    (user_id = (select auth.uid()) and private.has_teen_member_role('volunteer'))
    or private.is_site_administrator()
)
with check (
    (user_id = (select auth.uid()) and private.has_teen_member_role('volunteer'))
    or private.is_site_administrator()
);

create policy "Public can view published blog posts"
on public.blog_posts
for select
to anon, authenticated
using (
    status = 'published'
    or private.is_site_administrator()
    or (
        author_user_id = (select auth.uid())
        and private.has_teen_member_role('editor')
    )
);

create policy "Editors and admins can create blog posts"
on public.blog_posts
for insert
to authenticated
with check (
    (
        author_user_id = (select auth.uid())
        and private.has_teen_member_role('editor')
    )
    or private.is_site_administrator()
);

create policy "Editors can edit own posts and admins can edit all posts"
on public.blog_posts
for update
to authenticated
using (
    (
        author_user_id = (select auth.uid())
        and private.has_teen_member_role('editor')
    )
    or private.is_site_administrator()
)
with check (
    (
        author_user_id = (select auth.uid())
        and private.has_teen_member_role('editor')
    )
    or private.is_site_administrator()
);

create policy "Admins can delete blog posts"
on public.blog_posts
for delete
to authenticated
using (private.is_site_administrator());

create policy "Public can read blog media"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'blog-media');

create policy "Editors and admins can upload blog media"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'blog-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (
        private.has_teen_member_role('editor')
        or private.is_site_administrator()
    )
);

create policy "Editors manage own blog media and admins manage all blog media"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'blog-media'
    and (
        (
            owner_id = (select auth.uid())::text
            and private.has_teen_member_role('editor')
        )
        or private.is_site_administrator()
    )
)
with check (
    bucket_id = 'blog-media'
    and (
        (
            owner_id = (select auth.uid())::text
            and private.has_teen_member_role('editor')
        )
        or private.is_site_administrator()
    )
);

create policy "Editors delete own blog media and admins delete all blog media"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'blog-media'
    and (
        (
            owner_id = (select auth.uid())::text
            and private.has_teen_member_role('editor')
        )
        or private.is_site_administrator()
    )
);

revoke all on table public.household_members from anon, authenticated;
revoke all on table public.teen_member_role_assignments from anon, authenticated;
revoke all on table public.teen_volunteer_profiles from anon, authenticated;
revoke all on table public.guest_registration_claims from anon, authenticated;
revoke all on table public.blog_posts from anon, authenticated;

grant select, insert, update, delete on table public.household_members to authenticated;
grant select on table public.teen_member_role_assignments to authenticated;
grant select, insert, update on table public.teen_volunteer_profiles to authenticated;
grant select on table public.blog_posts to anon, authenticated;
grant insert, update, delete on table public.blog_posts to authenticated;

revoke all on table public.account_profiles from anon, authenticated;
revoke all on table public.site_administrators from anon, authenticated;
revoke all on table public.event_registrations from anon, authenticated;
revoke all on table public.event_registration_attendees from anon, authenticated;
revoke all on table public.teen_member_applications from anon, authenticated;
revoke all on table public.event_volunteer_assignments from anon, authenticated;
revoke all on table public.volunteer_service_hours from anon, authenticated;

grant select on table public.account_profiles to authenticated;
grant select on table public.site_administrators to authenticated;
grant select on table public.event_registrations to authenticated;
grant select on table public.event_registration_attendees to authenticated;
grant select on table public.teen_member_applications to authenticated;
grant select on table public.event_volunteer_assignments to authenticated;
grant select on table public.volunteer_service_hours to authenticated;

comment on view public.account_profiles is
    'Expand-phase canonical API for profiles. The physical table is renamed in the later contract migration.';
comment on view public.site_administrators is
    'Expand-phase canonical API for administrator access levels.';
comment on view public.event_registrations is
    'Expand-phase canonical API for household and guest event registrations.';
comment on table public.blog_posts is
    'Versioned structured blog content. HTML is never stored or rendered directly.';

create table private.platform_migration_audit (
    object_name text primary key,
    source_count bigint not null,
    canonical_count bigint not null,
    checked_at timestamptz not null default now(),
    constraint platform_migration_counts_match check (source_count = canonical_count)
);

insert into private.platform_migration_audit (object_name, source_count, canonical_count)
values
    ('account_profiles', (select count(*) from public.profiles), (select count(*) from public.account_profiles)),
    ('site_administrators', (select count(*) from public.admin_users), (select count(*) from public.site_administrators)),
    ('event_registrations', (select count(*) from public.registrations), (select count(*) from public.event_registrations)),
    ('event_registration_attendees', (select count(*) from public.registration_participants), (select count(*) from public.event_registration_attendees)),
    ('teen_member_applications', (select count(*) from public.volunteer_applications), (select count(*) from public.teen_member_applications)),
    ('event_volunteer_assignments', (select count(*) from public.volunteer_assignments), (select count(*) from public.event_volunteer_assignments)),
    ('volunteer_service_hours', (select count(*) from public.volunteer_hours), (select count(*) from public.volunteer_service_hours));

revoke all on table private.platform_migration_audit from public, anon, authenticated;
