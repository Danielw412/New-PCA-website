-- Keep the browser-facing account-context RPC SECURITY INVOKER, matching the
-- rest of the public API wrappers. The helper remains in the non-exposed
-- private schema; authenticated sessions only need EXECUTE so the public RPC
-- can evaluate whether the current session is anonymous.

alter function public.get_account_context() security invoker;
grant execute on function private.is_anonymous_user(uuid) to authenticated;

comment on function public.get_account_context() is
    'Returns the signed-in user profile, administrator level, and active Teen Member roles.';
