-- Retire registration check-in entirely. The website no longer issues, looks
-- up, or records check-in codes, so remove the Data API wrappers, their private
-- SECURITY DEFINER helpers, and the private token/audit table. When this was
-- written, production held one unused issued code and no recorded arrivals.
--
-- No CASCADE: if anything unexpected still depends on these objects, the
-- migration fails instead of silently dropping it.

drop function public.issue_registration_checkin_token(uuid);
drop function public.issue_guest_registration_checkin_token(uuid, text);
drop function public.lookup_registration_checkin(text);
drop function public.check_in_event_registration(text);
drop function public.check_in_registration_as_admin(uuid);

drop function private.issue_registration_checkin_token(uuid);
drop function private.issue_guest_registration_checkin_token(uuid, text);
drop function private.lookup_registration_checkin(text);
drop function private.check_in_event_registration(text);
drop function private.check_in_registration_as_admin(uuid);

-- Also removes registration_checkins_checked_in_by_idx.
drop table private.registration_checkins;
