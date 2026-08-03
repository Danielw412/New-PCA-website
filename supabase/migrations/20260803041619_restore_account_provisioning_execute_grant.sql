-- public.get_account_context() is security invoker and calls this private
-- helper to provision a permanent account after signup or email confirmation.
grant execute on function private.provision_account_profile(uuid) to authenticated;
