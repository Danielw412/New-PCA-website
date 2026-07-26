-- Restore the account-context RPC as a security-definer function.
--
-- The production function had been recreated as security invoker. Authenticated
-- callers could execute public.get_account_context(), but its call to the
-- intentionally private is_anonymous_user helper was rejected, preventing all
-- modular account and administration pages from initializing.

create or replace function public.get_account_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
    select jsonb_build_object(
        'user_id', auth.uid(),
        'is_anonymous', exists (
            select 1
            from auth.users
            where users.id = auth.uid()
              and users.is_anonymous = true
        ),
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

revoke execute on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated, service_role;

comment on function public.get_account_context() is
    'Returns the signed-in user profile, administrator level, and active Teen Member roles without exposing private helper functions.';
