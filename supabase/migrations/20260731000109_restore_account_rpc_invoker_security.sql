-- Keep browser-facing RPC wrappers invoker-safe. The private schema is not
-- exposed through the Data API, and each helper independently validates the
-- caller, account type, ownership, or administrator access before writing.

alter function public.ensure_account_profile() security invoker;
alter function public.get_account_context() security invoker;
alter function public.complete_household_account(text, text) security invoker;
alter function public.submit_volunteer_account_application(smallint, text, text) security invoker;
alter function public.review_volunteer_account_application(uuid, text, text) security invoker;
alter function public.delete_account_as_admin(uuid) security invoker;
alter function public.queue_volunteer_account_submission_emails(uuid) security invoker;
alter function public.submit_event_volunteer_request(uuid, jsonb) security invoker;

grant execute on function private.provision_account_profile(uuid) to authenticated;
grant execute on function private.complete_household_account(text, text) to authenticated;
grant execute on function private.submit_volunteer_account_application(smallint, text, text) to authenticated;
grant execute on function private.review_volunteer_account_application(uuid, text, text) to authenticated;
grant execute on function private.delete_account_as_admin(uuid) to authenticated;
grant execute on function private.queue_volunteer_account_submission_emails(uuid) to authenticated;
grant execute on function private.submit_event_volunteer_request(uuid, jsonb) to authenticated;

comment on function public.get_account_context() is
    'Invoker-safe account context that provisions a missing permanent profile through a validated private helper.';

notify pgrst, 'reload schema';
