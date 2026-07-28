-- Restore the invoker-safe account-context definition. The public RPC calls a
-- SECURITY DEFINER helper in the non-exposed private schema to inspect the
-- current auth user without granting browser sessions access to auth.users.

create or replace function public.get_account_context()
returns jsonb
language sql
stable
security invoker
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

revoke execute on function public.get_account_context() from public, anon;
grant execute on function public.get_account_context() to authenticated, service_role;
grant execute on function private.is_anonymous_user(uuid) to authenticated;

comment on function public.get_account_context() is
    'Returns the signed-in user profile, administrator level, and active Teen Member roles.';
