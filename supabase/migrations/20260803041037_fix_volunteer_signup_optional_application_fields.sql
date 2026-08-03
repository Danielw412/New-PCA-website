-- Volunteer Account signup provisions a pending application in the auth.users
-- trigger. The legacy interests and availability fields are optional, and their
-- current checks accept NULL but not an empty string.
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
            null,
            null
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
