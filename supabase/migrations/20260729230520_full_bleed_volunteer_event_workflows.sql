-- Full event and volunteer workflow refresh.
-- Destructive-looking event removal is intentionally implemented as a soft
-- delete so registrations, assignments, and service-hour audits are retained.

alter table public.events
    add column deleted_at timestamptz,
    add column deleted_by uuid references auth.users (id) on delete set null;

comment on column public.events.deleted_at is
    'When set, the event is archived from public discovery while dependent audit records remain intact.';

create index events_active_start_idx
    on public.events (starts_at, id)
    where deleted_at is null;

drop policy if exists "Public can view published events" on public.events;
create policy "Public can view published events"
on public.events
for select
to anon
using (published = true and deleted_at is null);

drop policy if exists "Authenticated users can view available registered assigned or a" on public.events;
create policy "Authenticated users can view active registered assigned or admin events"
on public.events
for select
to authenticated
using (
    (published = true and deleted_at is null)
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
    or private.is_site_administrator()
);

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
        when events.ends_at < now() then 'past'
        when events.starts_at <= now() then 'in_progress'
        else 'upcoming'
    end as lifecycle,
    (
        events.published
        and events.registration_open
        and events.starts_at > now()
    ) as registration_available
from public.events
where events.deleted_at is null;

revoke all on public.event_catalog from public;
grant select on public.event_catalog to anon, authenticated;

create or replace function private.delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    update public.events
    set
        published = false,
        registration_open = false,
        deleted_at = now(),
        deleted_by = auth.uid()
    where id = p_event_id
      and deleted_at is null;

    if not found then
        raise exception 'The event could not be found or was already deleted.' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.delete_event(p_event_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.delete_event($1);
$$;

revoke all on function private.delete_event(uuid) from public, anon, authenticated;
revoke all on function public.delete_event(uuid) from public, anon;
grant execute on function public.delete_event(uuid) to authenticated;

-- Record mailing consent on each registration. Existing registrations remain
-- opted out; the browser explicitly sends the visitor's current checkbox value.
alter table public.registrations
    add column future_event_emails boolean not null default false;

create or replace view public.event_registrations
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
    registrations.cancelled_at,
    registrations.future_event_emails
from public.registrations;

revoke all on public.event_registrations from public, anon;
grant select on public.event_registrations to authenticated;

create or replace function private.register_for_event_v3(
    p_event_id uuid,
    p_contact jsonb,
    p_attendees jsonb,
    p_referral_source text,
    p_referral_source_other text default null,
    p_future_event_emails boolean default false
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
    saved record;
begin
    select *
    into saved
    from private.register_for_event_v2(
        p_event_id,
        p_contact,
        p_attendees,
        p_referral_source,
        p_referral_source_other
    );

    update public.registrations
    set future_event_emails = coalesce(p_future_event_emails, false)
    where id = saved.registration_id;

    return query
    select
        saved.registration_id::uuid,
        saved.status::public.registration_status,
        saved.participant_count::integer,
        saved.guest_claim_token::text;
end;
$$;

create or replace function public.register_for_event(
    p_event_id uuid,
    p_contact jsonb,
    p_attendees jsonb,
    p_referral_source text,
    p_referral_source_other text,
    p_future_event_emails boolean
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
    from private.register_for_event_v3($1, $2, $3, $4, $5, $6);
$$;

revoke all on function private.register_for_event_v3(uuid, jsonb, jsonb, text, text, boolean) from public, anon, authenticated;
revoke all on function public.register_for_event(uuid, jsonb, jsonb, text, text, boolean) from public, anon;
grant execute on function public.register_for_event(uuid, jsonb, jsonb, text, text, boolean) to authenticated;

-- The permanent volunteer-account application no longer requires parent or
-- guardian information. Columns are retained only for historic records and
-- compatibility with cached clients.
alter table public.volunteer_applications
    drop constraint if exists volunteer_applications_parent_guardian_name_check,
    drop constraint if exists volunteer_applications_parent_guardian_email_check,
    drop constraint if exists volunteer_applications_parent_guardian_phone_check,
    drop constraint if exists volunteer_applications_parent_guardian_consent_check;

alter table public.volunteer_applications
    alter column parent_guardian_name drop not null,
    alter column parent_guardian_email drop not null,
    alter column parent_guardian_phone drop not null,
    alter column parent_guardian_consent drop not null;

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

    -- account_type is the legacy storage value retained for API compatibility.
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

create or replace function public.review_volunteer_account_application(
    p_application_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.review_volunteer_account_application($1, $2, $3);
$$;

revoke all on function private.review_volunteer_account_application(uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_volunteer_account_application(uuid, text, text) from public, anon;
grant execute on function public.review_volunteer_account_application(uuid, text, text) to authenticated;

-- Account-free event volunteer requests. Anonymous Auth still supplies a
-- short-lived authenticated identity, so the RPC can rate-limit ownership and
-- RLS can protect the submitted personal information.
create table public.event_volunteer_requests (
    id uuid primary key default gen_random_uuid(),
    event_id uuid not null references public.events (id) on delete restrict,
    requester_user_id uuid default auth.uid()
        references auth.users (id) on delete set null,
    linked_account_id uuid references public.profiles (id) on delete set null,
    full_name text not null
        check (char_length(btrim(full_name)) between 1 and 120),
    email text not null
        check (
            char_length(btrim(email)) between 3 and 320
            and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        ),
    age smallint not null check (age between 12 and 100),
    phone text check (phone is null or char_length(btrim(phone)) between 7 and 40),
    school_name text check (school_name is null or char_length(btrim(school_name)) between 1 and 200),
    interests text not null default '' check (char_length(interests) <= 2000),
    availability text not null default '' check (char_length(availability) <= 2000),
    future_event_emails boolean not null default true,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'cancelled')),
    admin_notes text not null default '' check (char_length(admin_notes) <= 4000),
    submitted_at timestamptz not null default now(),
    reviewed_by uuid references public.profiles (id) on delete set null,
    reviewed_at timestamptz,
    updated_at timestamptz not null default now(),
    constraint event_volunteer_request_review_shape check (
        (status = 'pending' and reviewed_by is null and reviewed_at is null)
        or (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
        or status = 'cancelled'
    )
);

comment on table public.event_volunteer_requests is
    'Account-optional requests to help at a specific PCA event; permanent accounts are only required for hour tracking.';

create unique index event_volunteer_requests_active_email_idx
    on public.event_volunteer_requests (event_id, lower(email))
    where status in ('pending', 'approved');

create index event_volunteer_requests_review_queue_idx
    on public.event_volunteer_requests (status, submitted_at, id);

create trigger event_volunteer_requests_set_updated_at
before update on public.event_volunteer_requests
for each row execute function private.set_updated_at();

alter table public.event_volunteer_requests enable row level security;

create policy "Requesters and administrators can view event volunteer requests"
on public.event_volunteer_requests
for select
to authenticated
using (
    requester_user_id = (select auth.uid())
    or private.is_site_administrator()
);

revoke all on public.event_volunteer_requests from public, anon, authenticated;
grant select on public.event_volunteer_requests to authenticated;

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

    if requested_age not between 12 and 100 then
        raise exception 'Enter an age from 12 to 100.' using errcode = '22023';
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

create or replace function public.submit_event_volunteer_request(
    p_event_id uuid,
    p_request jsonb
)
returns table (request_id uuid, status text)
language sql
security invoker
set search_path = ''
as $$
    select * from private.submit_event_volunteer_request($1, $2);
$$;

revoke all on function private.submit_event_volunteer_request(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.submit_event_volunteer_request(uuid, jsonb) from public, anon;
grant execute on function public.submit_event_volunteer_request(uuid, jsonb) to authenticated;

create or replace function private.review_event_volunteer_request(
    p_request_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    normalized_decision text := lower(btrim(coalesce(p_decision, '')));
    saved_request_id uuid;
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

    update public.event_volunteer_requests
    set
        status = normalized_decision,
        admin_notes = coalesce(p_admin_notes, ''),
        reviewed_by = auth.uid(),
        reviewed_at = now()
    where id = p_request_id
      and status = 'pending'
    returning id into saved_request_id;

    if saved_request_id is null then
        raise exception 'The pending volunteer request could not be found.' using errcode = 'P0002';
    end if;

    return saved_request_id;
end;
$$;

create or replace function public.review_event_volunteer_request(
    p_request_id uuid,
    p_decision text,
    p_admin_notes text default ''
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.review_event_volunteer_request($1, $2, $3);
$$;

revoke all on function private.review_event_volunteer_request(uuid, text, text) from public, anon, authenticated;
revoke all on function public.review_event_volunteer_request(uuid, text, text) from public, anon;
grant execute on function public.review_event_volunteer_request(uuid, text, text) to authenticated;

-- Transactional email outbox. Browser identities can only enqueue approved
-- templates through the validating RPC below; only the service role can read or
-- update the delivery rows used by the Edge Function.
create table public.transactional_email_deliveries (
    id uuid primary key default gen_random_uuid(),
    email_kind text not null check (email_kind in (
        'event_registration_confirmation',
        'volunteer_request_received',
        'volunteer_request_approved',
        'volunteer_account_approved'
    )),
    resource_id uuid not null,
    recipient text not null
        check (
            char_length(recipient) between 3 and 320
            and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
        ),
    payload jsonb not null,
    status text not null default 'queued'
        check (status in ('queued', 'processing', 'sent', 'failed')),
    attempts integer not null default 0 check (attempts >= 0),
    provider_message_id text,
    last_error text check (last_error is null or char_length(last_error) <= 2000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    sent_at timestamptz,
    unique (email_kind, resource_id, recipient)
);

create index transactional_email_delivery_queue_idx
    on public.transactional_email_deliveries (status, created_at, id)
    where status in ('queued', 'failed');

create trigger transactional_email_deliveries_set_updated_at
before update on public.transactional_email_deliveries
for each row execute function private.set_updated_at();

alter table public.transactional_email_deliveries enable row level security;

revoke all on public.transactional_email_deliveries from public, anon, authenticated;
grant select, insert, update on public.transactional_email_deliveries to service_role;

create or replace function private.queue_transactional_email(
    p_email_kind text,
    p_resource_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    caller_id uuid := auth.uid();
    caller_is_admin boolean := private.is_site_administrator(caller_id);
    destination text;
    message_payload jsonb;
    delivery_id uuid;
    registration_record record;
    request_record record;
    application_record record;
begin
    if caller_id is null then
        raise exception 'Authentication is required.' using errcode = '42501';
    end if;

    case p_email_kind
        when 'event_registration_confirmation' then
            select
                registrations.account_id,
                registrations.contact_name,
                lower(registrations.contact_email) as contact_email,
                registrations.status,
                registrations.participant_count,
                events.title as event_title,
                events.starts_at,
                events.ends_at,
                events.location
            into registration_record
            from public.registrations
            join public.events on events.id = registrations.event_id
            where registrations.id = p_resource_id;

            if not found then
                raise exception 'Registration could not be found.' using errcode = 'P0002';
            end if;

            if registration_record.account_id is distinct from caller_id and not caller_is_admin then
                raise exception 'You cannot send this confirmation.' using errcode = '42501';
            end if;

            destination := registration_record.contact_email;
            message_payload := jsonb_build_object(
                'contact_name', registration_record.contact_name,
                'event_title', registration_record.event_title,
                'starts_at', registration_record.starts_at,
                'ends_at', registration_record.ends_at,
                'location', registration_record.location,
                'status', registration_record.status,
                'participant_count', registration_record.participant_count
            );

        when 'volunteer_request_received' then
            select
                requests.requester_user_id,
                requests.full_name,
                requests.email,
                requests.age,
                requests.phone,
                requests.school_name,
                requests.interests,
                requests.availability,
                events.title as event_title,
                events.starts_at,
                events.location
            into request_record
            from public.event_volunteer_requests as requests
            join public.events on events.id = requests.event_id
            where requests.id = p_resource_id;

            if not found then
                raise exception 'Volunteer request could not be found.' using errcode = 'P0002';
            end if;

            if request_record.requester_user_id is distinct from caller_id and not caller_is_admin then
                raise exception 'You cannot send this notification.' using errcode = '42501';
            end if;

            destination := 'pcayouthcenter@gmail.com';
            message_payload := jsonb_build_object(
                'full_name', request_record.full_name,
                'email', request_record.email,
                'age', request_record.age,
                'phone', request_record.phone,
                'school_name', request_record.school_name,
                'interests', request_record.interests,
                'availability', request_record.availability,
                'event_title', request_record.event_title,
                'starts_at', request_record.starts_at,
                'location', request_record.location
            );

        when 'volunteer_request_approved' then
            if not caller_is_admin then
                raise exception 'Administrator access is required.' using errcode = '42501';
            end if;

            select
                requests.full_name,
                lower(requests.email) as email,
                requests.status,
                requests.admin_notes,
                events.title as event_title,
                events.starts_at,
                events.location
            into request_record
            from public.event_volunteer_requests as requests
            join public.events on events.id = requests.event_id
            where requests.id = p_resource_id;

            if not found or request_record.status <> 'approved' then
                raise exception 'An approved volunteer request could not be found.' using errcode = 'P0002';
            end if;

            destination := request_record.email;
            message_payload := jsonb_build_object(
                'full_name', request_record.full_name,
                'event_title', request_record.event_title,
                'starts_at', request_record.starts_at,
                'location', request_record.location,
                'admin_notes', request_record.admin_notes
            );

        when 'volunteer_account_approved' then
            if not caller_is_admin then
                raise exception 'Administrator access is required.' using errcode = '42501';
            end if;

            select
                applications.status,
                applications.admin_notes,
                profiles.full_name,
                lower(profiles.email) as email
            into application_record
            from public.volunteer_applications as applications
            join public.profiles on profiles.id = applications.user_id
            where applications.id = p_resource_id;

            if not found or application_record.status <> 'approved' then
                raise exception 'An approved volunteer account application could not be found.' using errcode = 'P0002';
            end if;

            destination := application_record.email;
            message_payload := jsonb_build_object(
                'full_name', application_record.full_name,
                'admin_notes', application_record.admin_notes
            );

        else
            raise exception 'Unsupported email template.' using errcode = '22023';
    end case;

    if destination is null then
        raise exception 'The email recipient is missing.' using errcode = '22023';
    end if;

    insert into public.transactional_email_deliveries (
        email_kind,
        resource_id,
        recipient,
        payload
    )
    values (
        p_email_kind,
        p_resource_id,
        lower(destination),
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
    returning id into delivery_id;

    return delivery_id;
end;
$$;

create or replace function public.queue_transactional_email(
    p_email_kind text,
    p_resource_id uuid
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
    select private.queue_transactional_email($1, $2);
$$;

revoke all on function private.queue_transactional_email(text, uuid) from public, anon, authenticated;
revoke all on function public.queue_transactional_email(text, uuid) from public, anon;
grant execute on function public.queue_transactional_email(text, uuid) to authenticated;
