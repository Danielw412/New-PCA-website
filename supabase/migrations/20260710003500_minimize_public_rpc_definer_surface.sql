-- Keep the browser-facing API SECURITY INVOKER. The exact private
-- implementations are executable by the authenticated database role so the
-- invoker wrappers can call them, but the private schema is not exposed by the
-- Data API. Each implementation is SECURITY DEFINER with a fixed empty
-- search_path and performs its own auth.uid(), ownership, and role checks.

alter function public.register_for_event(uuid, jsonb, jsonb, text, text) security invoker;
alter function public.update_event_registration(uuid, jsonb, jsonb) security invoker;
alter function public.cancel_event_registration(uuid) security invoker;
alter function public.claim_guest_registration(text) security invoker;
alter function public.complete_household_account(text, text) security invoker;
alter function public.save_event(uuid, jsonb) security invoker;
alter function public.delete_event_draft(uuid) security invoker;
alter function public.review_teen_member_application(uuid, text, text) security invoker;
alter function public.replace_teen_member_roles(uuid, public.teen_member_role[]) security invoker;
alter function public.promote_account_to_admin(uuid, public.site_admin_level) security invoker;
alter function public.demote_admin(uuid) security invoker;
alter function public.save_account_profile(uuid, text, text, text) security invoker;

grant execute on function private.register_for_event_v2(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function private.update_event_registration(uuid, jsonb, jsonb) to authenticated;
grant execute on function private.cancel_event_registration(uuid) to authenticated;
grant execute on function private.claim_guest_registration(text) to authenticated;
grant execute on function private.complete_household_account(text, text) to authenticated;
grant execute on function private.save_event(uuid, jsonb) to authenticated;
grant execute on function private.delete_event_draft(uuid) to authenticated;
grant execute on function private.review_teen_member_application(uuid, text, text) to authenticated;
grant execute on function private.replace_teen_member_roles(uuid, public.teen_member_role[]) to authenticated;
grant execute on function private.promote_account_to_admin(uuid, public.site_admin_level) to authenticated;
grant execute on function private.demote_admin(uuid) to authenticated;
grant execute on function private.save_account_profile(uuid, text, text, text) to authenticated;
