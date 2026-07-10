-- Forward-only hardening after reviewing the production advisors. The public
-- RPC wrappers must run with the function owner's privileges because their
-- private implementations are intentionally not executable by browser roles.
-- Every implementation performs its own auth.uid(), ownership, and role checks
-- and all functions retain an empty fixed search_path.

alter function public.register_for_event(uuid, jsonb, jsonb, text, text) security definer;
alter function public.update_event_registration(uuid, jsonb, jsonb) security definer;
alter function public.cancel_event_registration(uuid) security definer;
alter function public.claim_guest_registration(text) security definer;
alter function public.complete_household_account(text, text) security definer;
alter function public.save_event(uuid, jsonb) security definer;
alter function public.delete_event_draft(uuid) security definer;
alter function public.review_teen_member_application(uuid, text, text) security definer;
alter function public.replace_teen_member_roles(uuid, public.teen_member_role[]) security definer;
alter function public.promote_account_to_admin(uuid, public.site_admin_level) security definer;
alter function public.demote_admin(uuid) security definer;
alter function public.save_account_profile(uuid, text, text, text) security definer;

-- Public buckets serve known object URLs without a SELECT policy. Removing the
-- broad policy prevents anonymous listing of every editor upload.
drop policy if exists "Public can read blog media" on storage.objects;

-- Guest claim rows are reachable only through the hashed-token RPC. An
-- explicit deny policy documents the boundary and keeps direct Data API access
-- closed even if a table grant is added accidentally later.
create policy "Guest claims are RPC only"
on public.guest_registration_claims
for all
to anon, authenticated
using (false)
with check (false);

drop policy if exists "Users can check their admin membership" on public.admin_users;
drop policy if exists "Super admins can view all administrators" on public.admin_users;

create policy "Users view own admin access and super admins view all"
on public.admin_users
for select
to authenticated
using (
    user_id = (select auth.uid())
    or private.is_super_administrator()
);

create index admin_users_granted_by_idx
    on public.admin_users (granted_by);
create index guest_registration_claims_claimed_by_idx
    on public.guest_registration_claims (claimed_by);
create index registration_participants_household_member_idx
    on public.registration_participants (household_member_id);
create index teen_member_role_assignments_assigned_by_idx
    on public.teen_member_role_assignments (assigned_by);
create index teen_member_role_assignments_revoked_by_idx
    on public.teen_member_role_assignments (revoked_by);
