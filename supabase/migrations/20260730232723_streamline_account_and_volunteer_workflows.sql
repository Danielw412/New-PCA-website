-- Keep permanent PCA account provisioning durable when an anonymous event
-- registration identity is upgraded and email confirmation completes later.
-- Profile and authorization state remain database-owned; user metadata is read
-- only while creating the first immutable account type.

alter table public.event_volunteer_requests
    drop constraint if exists event_volunteer_requests_age_check,
    add constraint event_volunteer_requests_age_check check (age between 0 and 100);

alter table public.volunteer_applications
    drop constraint if exists volunteer_applications_age_check,
    add constraint volunteer_applications_age_check check (age between 0 and 100),
    alter column phone set not null,
    alter column school_name set not null;

create or replace function private.provision_account_profile(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    auth_record record;
    profile_name text;
    requested_account_type text;
    legacy_account_use text;
    normalized_email text;
    normalized_phone text;
    normalized_school text;
    requested_age smallint;
begin
    if p_user_id is null then
        return null;
    end if;

    select
        users.email,
        users.is_anonymous,
        coalesce(users.raw_user_meta_data, '{}'::jsonb) as metadata
    into auth_record
    from auth.users as users
    where users.id = p_user_id;

    if not found then
        raise exception 'Account authentication record could not be found.' using errcode = 'P0002';
    end if;

    if coalesce(auth_record.is_anonymous, false) or auth_record.email is null then
        return null;
    end if;

    normalized_email := lower(btrim(auth_record.email));

    if char_length(normalized_email) not between 3 and 320 then
        raise exception 'A valid email address is required.' using errcode = '22023';
    end if;

    if exists (select 1 from public.profiles where profiles.id = p_user_id) then
        update public.profiles
        set email = normalized_email
        where id = p_user_id
          and email is distinct from normalized_email;
        return p_user_id;
    end if;

    profile_name := btrim(coalesce(auth_record.metadata ->> 'full_name', ''));
    requested_account_type := lower(btrim(coalesce(auth_record.metadata ->> 'account_type', '')));
    legacy_account_use := lower(btrim(coalesce(auth_record.metadata ->> 'account_use', '')));
    normalized_phone := nullif(btrim(coalesce(
        auth_record.metadata ->> 'contact_phone',
        auth_record.metadata ->> 'phone',
        ''
    )), '');

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

    if normalized_phone is not null and char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Phone numbers must be between 7 and 40 characters.' using errcode = '22023';
    end if;

    if requested_account_type = 'teen_member' then
        normalized_school := nullif(btrim(coalesce(auth_record.metadata ->> 'school_name', '')), '');

        begin
            requested_age := (auth_record.metadata ->> 'age')::smallint;
        exception when others then
            raise exception 'Enter a valid age.' using errcode = '22023';
        end;

        if requested_age not between 0 and 100 then
            raise exception 'Enter an age from 0 to 100.' using errcode = '22023';
        end if;

        if normalized_phone is null then
            raise exception 'Enter the volunteer student phone number.' using errcode = '22023';
        end if;

        if normalized_school is null or char_length(normalized_school) > 200 then
            raise exception 'Enter a school name of 200 characters or fewer.' using errcode = '22023';
        end if;
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
        p_user_id,
        profile_name,
        normalized_email,
        normalized_email,
        normalized_phone,
        requested_account_type::public.account_type,
        case requested_account_type
            when 'teen_member' then 'volunteer'::public.account_use
            else 'household'::public.account_use
        end
    )
    on conflict (id) do nothing;

    if requested_account_type = 'teen_member' then
        insert into public.volunteer_applications (
            user_id,
            age,
            phone,
            school_name,
            interests,
            availability
        )
        values (
            p_user_id,
            requested_age,
            normalized_phone,
            normalized_school,
            '',
            ''
        )
        on conflict (user_id) do nothing;
    else
        update public.registrations
        set
            registration_source = 'household',
            contact_name = profile_name,
            contact_email = normalized_email,
            contact_phone = coalesce(normalized_phone, registrations.contact_phone)
        where account_id = p_user_id;

        update public.guest_registration_claims as claims
        set claimed_by = p_user_id, claimed_at = now()
        from public.registrations as registrations
        where registrations.id = claims.registration_id
          and registrations.account_id = p_user_id
          and claims.claimed_at is null;
    end if;

    return p_user_id;
end;
$$;

revoke all on function private.provision_account_profile(uuid) from public, anon, authenticated;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.provision_account_profile(new.id);
    return new;
end;
$$;

create or replace function private.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.provision_account_profile(new.id);

    if new.email is not null and new.email is distinct from old.email then
        update public.profiles
        set email = lower(btrim(new.email))
        where id = new.id;
    end if;

    return new;
end;
$$;

drop trigger if exists sync_profile_after_email_change on auth.users;
create trigger sync_profile_after_email_change
after update of email, is_anonymous on auth.users
for each row execute function private.sync_profile_email();

create or replace function public.ensure_account_profile()
returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.provision_account_profile(auth.uid());
$$;

revoke all on function public.ensure_account_profile() from public, anon;
grant execute on function public.ensure_account_profile() to authenticated;

create or replace function public.get_account_context()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_context jsonb;
begin
    perform private.provision_account_profile(auth.uid());

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
    ) into account_context;

    return account_context;
end;
$$;

revoke all on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated;

create or replace function private.complete_household_account(
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
    normalized_name text := btrim(coalesce(p_full_name, ''));
    normalized_phone text := btrim(coalesce(p_contact_phone, ''));
begin
    if current_user_id is null then
        raise exception 'Your account session has expired.' using errcode = '42501';
    end if;

    if char_length(normalized_name) not between 1 and 120 then
        raise exception 'Account holder name must be between 1 and 120 characters.' using errcode = '22023';
    end if;

    if char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Contact phone must be between 7 and 40 characters.' using errcode = '22023';
    end if;

    -- Anonymous conversions remain pending until the confirmation link changes
    -- the Auth identity to permanent. The update trigger provisions the profile
    -- and attaches registrations at that point.
    perform private.provision_account_profile(current_user_id);
    return current_user_id;
end;
$$;

create or replace function public.complete_household_account(
    p_full_name text,
    p_contact_phone text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.complete_household_account($1, $2);
$$;

revoke all on function private.complete_household_account(text, text) from public, anon, authenticated;
revoke all on function public.complete_household_account(text, text) from public, anon;
grant execute on function public.complete_household_account(text, text) to authenticated;

create or replace function private.submit_volunteer_account_application(
    p_age smallint,
    p_phone text,
    p_school_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    normalized_phone text := btrim(coalesce(p_phone, ''));
    normalized_school text := btrim(coalesce(p_school_name, ''));
    application_id uuid;
begin
    if caller_id is null or not exists (
        select 1
        from public.profiles
        where id = caller_id
          and account_type = 'teen_member'
    ) then
        raise exception 'A permanent Volunteer Account is required.' using errcode = '42501';
    end if;

    if p_age not between 0 and 100 then
        raise exception 'Enter an age from 0 to 100.' using errcode = '22023';
    end if;

    if char_length(normalized_phone) not between 7 and 40 then
        raise exception 'Enter the volunteer student phone number.' using errcode = '22023';
    end if;

    if char_length(normalized_school) not between 1 and 200 then
        raise exception 'Enter a school name of 200 characters or fewer.' using errcode = '22023';
    end if;

    select id into application_id
    from public.volunteer_applications
    where user_id = caller_id;

    if application_id is not null then
        return application_id;
    end if;

    insert into public.volunteer_applications (
        user_id,
        age,
        phone,
        school_name,
        interests,
        availability
    )
    values (caller_id, p_age, normalized_phone, normalized_school, '', '')
    returning id into application_id;

    update public.profiles
    set contact_phone = normalized_phone
    where id = caller_id;

    return application_id;
end;
$$;

create or replace function public.submit_volunteer_account_application(
    p_age smallint,
    p_phone text,
    p_school_name text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.submit_volunteer_account_application($1, $2, $3);
$$;

revoke all on function private.submit_volunteer_account_application(smallint, text, text) from public, anon, authenticated;
revoke all on function public.submit_volunteer_account_application(smallint, text, text) from public, anon;
grant execute on function public.submit_volunteer_account_application(smallint, text, text) to authenticated;

create or replace function private.review_volunteer_account_application(
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
        raise exception 'Volunteer account application could not be found.' using errcode = 'P0002';
    end if;

    if normalized_decision = 'approved' then
        insert into public.teen_member_role_assignments (user_id, role, assigned_by)
        select applicant_user_id, 'volunteer'::public.teen_member_role, auth.uid()
        where not exists (
            select 1
            from public.teen_member_role_assignments
            where user_id = applicant_user_id
              and role = 'volunteer'
              and revoked_at is null
        );

        insert into public.teen_volunteer_profiles (user_id, school_name, phone)
        select applications.user_id, applications.school_name, applications.phone
        from public.volunteer_applications as applications
        where applications.id = p_application_id
        on conflict (user_id) do update
        set
            school_name = coalesce(nullif(teen_volunteer_profiles.school_name, ''), excluded.school_name),
            phone = coalesce(nullif(teen_volunteer_profiles.phone, ''), excluded.phone);
    else
        update public.teen_member_role_assignments
        set revoked_by = auth.uid(), revoked_at = now()
        where user_id = applicant_user_id
          and role = 'volunteer'
          and revoked_at is null;
    end if;

    return applicant_user_id;
end;
$$;

create or replace function public.review_volunteer_account_application(
    p_application_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.review_volunteer_account_application($1, $2, $3);
$$;

revoke all on function private.review_volunteer_account_application(uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_volunteer_account_application(uuid, text, text) from public, anon;
grant execute on function public.review_volunteer_account_application(uuid, text, text) to authenticated;

create or replace function private.delete_account_as_admin(p_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
begin
    if not private.is_site_administrator(caller_id) then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if p_target_user_id is null then
        raise exception 'Choose an account to delete.' using errcode = '22023';
    end if;

    if p_target_user_id = caller_id then
        raise exception 'You cannot delete your own administrator account.' using errcode = '42501';
    end if;

    if exists (select 1 from public.admin_users where user_id = p_target_user_id) then
        raise exception 'Remove administrator access before deleting this account.' using errcode = '42501';
    end if;

    if not exists (select 1 from public.profiles where id = p_target_user_id) then
        raise exception 'The account could not be found.' using errcode = 'P0002';
    end if;

    delete from public.transactional_email_deliveries
    where resource_id in (
        select id
        from public.volunteer_applications
        where user_id = p_target_user_id
    )
      and email_kind like 'volunteer_account_%';

    delete from auth.users where id = p_target_user_id;

    if not found then
        raise exception 'The account could not be deleted.' using errcode = 'P0002';
    end if;

    return p_target_user_id;
end;
$$;

create or replace function public.delete_account_as_admin(p_target_user_id uuid)
returns uuid
language sql
security definer
set search_path = ''
as $$
    select private.delete_account_as_admin($1);
$$;

revoke all on function private.delete_account_as_admin(uuid) from public, anon, authenticated;
revoke all on function public.delete_account_as_admin(uuid) from public, anon;
grant execute on function public.delete_account_as_admin(uuid) to authenticated;

alter table public.transactional_email_deliveries
    drop constraint if exists transactional_email_deliveries_email_kind_check,
    add constraint transactional_email_deliveries_email_kind_check check (email_kind in (
        'event_registration_confirmation',
        'volunteer_request_received',
        'volunteer_request_approved',
        'volunteer_account_submitted_admin',
        'volunteer_account_submitted_volunteer',
        'volunteer_account_approved'
    ));

create or replace function private.queue_volunteer_account_submission_emails(p_application_id uuid)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    application_record record;
    message_payload jsonb;
    admin_delivery_id uuid;
    volunteer_delivery_id uuid;
begin
    if caller_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    select
        applications.user_id,
        applications.age,
        applications.phone,
        applications.school_name,
        applications.status,
        profiles.full_name,
        lower(profiles.email) as email
    into application_record
    from public.volunteer_applications as applications
    join public.profiles on profiles.id = applications.user_id
    where applications.id = p_application_id;

    if not found then
        raise exception 'Volunteer account application could not be found.' using errcode = 'P0002';
    end if;

    if application_record.user_id is distinct from caller_id
       and not private.is_site_administrator(caller_id) then
        raise exception 'You cannot send this notification.' using errcode = '42501';
    end if;

    message_payload := jsonb_build_object(
        'full_name', application_record.full_name,
        'email', application_record.email,
        'age', application_record.age,
        'phone', application_record.phone,
        'school_name', application_record.school_name,
        'status', application_record.status
    );

    insert into public.transactional_email_deliveries (
        email_kind,
        resource_id,
        recipient,
        payload
    )
    values (
        'volunteer_account_submitted_admin',
        p_application_id,
        'pcayouthcenter@gmail.com',
        message_payload
    )
    on conflict (email_kind, resource_id, recipient)
    do update set
        payload = excluded.payload,
        status = case
            when transactional_email_deliveries.status = 'sent' then 'sent'
            else 'queued'
        end,
        last_error = case
            when transactional_email_deliveries.status = 'sent' then transactional_email_deliveries.last_error
            else null
        end
    returning id into admin_delivery_id;

    insert into public.transactional_email_deliveries (
        email_kind,
        resource_id,
        recipient,
        payload
    )
    values (
        'volunteer_account_submitted_volunteer',
        p_application_id,
        application_record.email,
        message_payload
    )
    on conflict (email_kind, resource_id, recipient)
    do update set
        payload = excluded.payload,
        status = case
            when transactional_email_deliveries.status = 'sent' then 'sent'
            else 'queued'
        end,
        last_error = case
            when transactional_email_deliveries.status = 'sent' then transactional_email_deliveries.last_error
            else null
        end
    returning id into volunteer_delivery_id;

    return array[admin_delivery_id, volunteer_delivery_id];
end;
$$;

create or replace function public.queue_volunteer_account_submission_emails(p_application_id uuid)
returns uuid[]
language sql
security definer
set search_path = ''
as $$
    select private.queue_volunteer_account_submission_emails($1);
$$;

revoke all on function private.queue_volunteer_account_submission_emails(uuid) from public, anon, authenticated;
revoke all on function public.queue_volunteer_account_submission_emails(uuid) from public, anon;
grant execute on function public.queue_volunteer_account_submission_emails(uuid) to authenticated;

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

    if not exists (
        select 1
        from public.events
        where id = p_event_id
          and published = true
          and deleted_at is null
          and starts_at > now()
    ) then
        raise exception 'This event is not accepting volunteer requests.' using errcode = 'P0002';
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

revoke all on function private.submit_event_volunteer_request(uuid, jsonb) from public, anon, authenticated;

create or replace function public.submit_event_volunteer_request(
    p_event_id uuid,
    p_request jsonb
)
returns table (request_id uuid, status text)
language sql
security definer
set search_path = ''
as $$
    select * from private.submit_event_volunteer_request($1, $2);
$$;

revoke all on function public.submit_event_volunteer_request(uuid, jsonb) from public, anon;
grant execute on function public.submit_event_volunteer_request(uuid, jsonb) to authenticated;

comment on function public.ensure_account_profile() is
    'Idempotently provisions a permanent PCA profile after Auth confirmation, including delayed anonymous-to-permanent conversions.';
comment on function public.delete_account_as_admin(uuid) is
    'Administrator-only deletion of a non-administrator household or Volunteer Account and its dependent account records.';
comment on function public.submit_volunteer_account_application(smallint, text, text) is
    'Submits required age, student phone, and school data for a Volunteer Account without exposing direct table inserts.';

notify pgrst, 'reload schema';
