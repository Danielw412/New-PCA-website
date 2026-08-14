-- blog_posts validates structured content with a CHECK constraint that calls
-- private.blog_content_is_valid(jsonb). Inserts and updates run that CHECK as
-- the authenticated caller, so the caller needs EXECUTE on the validator.
-- The function is immutable and only validates its JSON argument.
grant execute on function private.blog_content_is_valid(jsonb) to authenticated;
