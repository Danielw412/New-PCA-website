-- Public buckets serve object URLs without a SELECT policy. Removing this
-- policy keeps headshots public while preventing unauthenticated bucket lists.
drop policy if exists "Public can view council headshots" on storage.objects;
