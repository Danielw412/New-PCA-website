-- Give household registration its own admin switch, independent of volunteer
-- sign-ups. Only registration_open changes; the registration RPCs already
-- enforce it under a row lock, and reopening fires the existing
-- promote_waitlist_after_event_change trigger that moves waitlisted groups in.

create function private.set_event_registration_open(
    p_event_id uuid,
    p_open boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
    event_starts_at timestamptz;
    saved_state boolean;
begin
    if not private.is_site_administrator() then
        raise exception 'Administrator access is required.' using errcode = '42501';
    end if;

    if p_open is null then
        raise exception 'Choose whether registration is open.' using errcode = '22023';
    end if;

    select events.starts_at
    into event_starts_at
    from public.events
    where id = p_event_id
      and deleted_at is null
    for update;

    if not found then
        raise exception 'The event could not be found or was deleted.' using errcode = 'P0002';
    end if;

    if p_open and event_starts_at is null then
        raise exception 'Add a start time before opening registration.' using errcode = '22023';
    end if;

    update public.events
    set registration_open = p_open
    where id = p_event_id
    returning registration_open into saved_state;

    return saved_state;
end;
$$;

create function public.set_event_registration_open(
    p_event_id uuid,
    p_open boolean
)
returns boolean
language sql
security invoker
set search_path = ''
as $$
    select private.set_event_registration_open($1, $2);
$$;

comment on function public.set_event_registration_open(uuid, boolean) is
    'Administrator-only switch that ends or reopens household registration for one event without changing volunteer sign-ups.';

revoke all on function private.set_event_registration_open(uuid, boolean)
from public, anon, service_role;
grant execute on function private.set_event_registration_open(uuid, boolean) to authenticated;

revoke all on function public.set_event_registration_open(uuid, boolean) from public, anon;
grant execute on function public.set_event_registration_open(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
