create function private.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    account_user_id uuid := auth.uid();
begin
    if account_user_id is null then
        raise exception 'You must be signed in to delete your account.'
            using errcode = '42501';
    end if;

    delete from auth.users
    where id = account_user_id;

    if not found then
        raise exception 'Your account could not be found.'
            using errcode = 'P0002';
    end if;
end;
$$;

create function public.delete_own_account()
returns void
language sql
security invoker
set search_path = ''
as $$
    select private.delete_own_account();
$$;

revoke execute on function private.delete_own_account()
    from public, anon, authenticated;
revoke execute on function public.delete_own_account()
    from public, anon, authenticated;

grant execute on function private.delete_own_account()
    to authenticated;
grant execute on function public.delete_own_account()
    to authenticated;

comment on function public.delete_own_account() is
    'Permanently deletes the signed-in Auth user and all account data connected through cascading foreign keys.';
