create policy "Users can update their profile name"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

grant update (full_name) on table public.profiles to authenticated;

comment on policy "Users can update their profile name" on public.profiles is
    'Allows signed-in users to update only their own profile row; column grants restrict browser updates to full_name.';
