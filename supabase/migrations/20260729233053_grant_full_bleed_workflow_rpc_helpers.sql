-- Public wrappers are security-invoker functions. PostgreSQL therefore checks
-- EXECUTE on their private helpers for the calling role as well. The private
-- schema is not exposed through the Data API, and every helper independently
-- validates auth.uid(), account type, ownership, or administrator access.
grant execute on function private.delete_event(uuid) to authenticated;
grant execute on function private.register_for_event_v3(uuid, jsonb, jsonb, text, text, boolean) to authenticated;
grant execute on function private.review_volunteer_account_application(uuid, text, text) to authenticated;
grant execute on function private.submit_event_volunteer_request(uuid, jsonb) to authenticated;
grant execute on function private.review_event_volunteer_request(uuid, text, text) to authenticated;
grant execute on function private.queue_transactional_email(text, uuid) to authenticated;
