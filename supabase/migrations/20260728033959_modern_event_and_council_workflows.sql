-- Give public event discovery one automatic lifecycle source. The security
-- invoker view preserves the RLS policies on public.events for every caller.
create or replace view public.event_catalog
with (security_invoker = true, security_barrier = true)
as
select
    events.id,
    events.title,
    events.description,
    events.location,
    events.starts_at,
    events.ends_at,
    events.capacity,
    events.max_participants_per_registration,
    events.registration_open,
    events.published,
    events.created_at,
    events.updated_at,
    case
        when events.ends_at < now() then 'past'
        when events.starts_at <= now() then 'in_progress'
        else 'upcoming'
    end as lifecycle,
    (
        events.published
        and events.registration_open
        and events.starts_at > now()
    ) as registration_available
from public.events;

comment on view public.event_catalog is
    'RLS-aware event discovery view whose lifecycle changes automatically from upcoming to past after ends_at.';

revoke all on public.event_catalog from public;
grant select on public.event_catalog to anon, authenticated;

create index if not exists events_public_lifecycle_idx
    on public.events (ends_at desc, starts_at desc)
    where published = true;

-- Public Student Council roster. Rows are seeded from the existing static
-- page so the migration preserves every currently listed person and bio.
create table public.student_council_members (
    id uuid primary key default gen_random_uuid(),
    full_name text not null
        check (char_length(btrim(full_name)) between 1 and 120),
    role_title text not null
        check (char_length(btrim(role_title)) between 1 and 120),
    member_group text not null
        check (member_group in ('advisor', 'officer', 'member')),
    bio text not null default ''
        check (char_length(bio) <= 1200),
    headshot_path text
        check (
            headshot_path is null
            or (
                char_length(headshot_path) between 1 and 500
                and headshot_path !~ '(^|/)\.\.(/|$)'
            )
        ),
    display_order integer not null default 0
        check (display_order between 0 and 10000),
    published boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (full_name, role_title, member_group)
);

comment on table public.student_council_members is
    'Administrator-managed public Student Council roster and officer descriptions.';
comment on column public.student_council_members.headshot_path is
    'Object path in the council-headshots Storage bucket; never a private or service-role URL.';

create trigger student_council_members_set_updated_at
before update on public.student_council_members
for each row execute function private.set_updated_at();

alter table public.student_council_members enable row level security;

create policy "Public can view published council members"
on public.student_council_members
for select
to anon, authenticated
using (published or private.is_site_administrator());

create policy "Administrators can create council members"
on public.student_council_members
for insert
to authenticated
with check (private.is_site_administrator());

create policy "Administrators can update council members"
on public.student_council_members
for update
to authenticated
using (private.is_site_administrator())
with check (private.is_site_administrator());

create policy "Administrators can delete council members"
on public.student_council_members
for delete
to authenticated
using (private.is_site_administrator());

revoke all on public.student_council_members from public;
grant select on public.student_council_members to anon;
grant select, insert, update, delete on public.student_council_members to authenticated;

create index student_council_public_order_idx
    on public.student_council_members (member_group, display_order, full_name)
    where published = true;

insert into public.student_council_members
    (full_name, role_title, member_group, bio, display_order)
values
    ('Ava Liu', 'Advisor', 'advisor', 'Ava Liu joined PCA Youth Center Student Council in 2021. She likes listening to music, sleeping in, questioning reality, and reading.', 10),
    ('Shirley Deng', 'Advisor', 'advisor', 'Shirley Deng joined PCA Youth Center Student Council in 2022. She likes to dance, bake, and play the violin and piano.', 20),
    ('Angelina Li', 'President', 'officer', 'Angelina is president of PCA Youth Center Student Council. She enjoys swimming, reading, and hanging out with friends.', 100),
    ('Zoey Guo', 'President', 'officer', 'Hi, I''m Zoey. I joined PCA in 2021. I play tennis and viola. In my free time, I enjoy reading, painting, biking, and cooking.', 110),
    ('Joanna Bi', 'Vice President', 'officer', 'Joanna Bi is the vice president of PCA Youth Center Student Council. She enjoys playing viola, baking, and hanging out with friends.', 120),
    ('Lynsey Zhao', 'Vice President', 'officer', 'Lynsey Zhao is the vice president of the PCA Youth Center Student Council. She enjoys rhythmic gymnastics, art, and reading.', 130),
    ('Elena Xiao', 'PR Director', 'officer', 'Elena Xiao joined PCA Youth Center Student Council in 2025. She loves traveling, visiting art museums, and reading.', 140),
    ('Joy Zhang', 'Secretary', 'officer', 'Joy Zhang joined PCA Youth Center Student Council in 2024. She likes listening to audiobooks, crocheting, and trying new foods.', 150),
    ('Casey Yang', 'Webmaster', 'officer', 'Casey Yang joined PCA Youth Center Student Council in 2023. She enjoys reading and petting her two cats.', 160),
    ('Alex Liang', 'Council Member', 'member', '', 1000),
    ('Allison Guan', 'Council Member', 'member', '', 1010),
    ('Andrew Feng', 'Council Member', 'member', '', 1020),
    ('Angela Zeng', 'Council Member', 'member', '', 1030),
    ('Benjamin Shuai', 'Council Member', 'member', '', 1040),
    ('Bella Liu', 'Council Member', 'member', '', 1050),
    ('Daniel Wang', 'Council Member', 'member', '', 1060),
    ('Emily Wei', 'Council Member', 'member', '', 1070),
    ('Grace Zhou', 'Council Member', 'member', '', 1080),
    ('Hanna Qian', 'Council Member', 'member', '', 1090),
    ('Henry Sun', 'Council Member', 'member', '', 1100),
    ('Iris Wu', 'Council Member', 'member', '', 1110),
    ('Jason Zhou', 'Council Member', 'member', '', 1120),
    ('Lucas Wang', 'Council Member', 'member', '', 1130),
    ('Lydia Tang', 'Council Member', 'member', '', 1140),
    ('Muriel Liu', 'Council Member', 'member', '', 1150),
    ('Rebecca Zhao', 'Council Member', 'member', '', 1160),
    ('Sophie Li', 'Council Member', 'member', '', 1170),
    ('Sue Park', 'Council Member', 'member', '', 1180),
    ('Yixin Zhang', 'Council Member', 'member', '', 1190),
    ('Yuanhao You', 'Council Member', 'member', '', 1200),
    ('Yuantao Tang', 'Council Member', 'member', '', 1210),
    ('Zhaolin Lu', 'Council Member', 'member', '', 1220)
on conflict (full_name, role_title, member_group) do nothing;

-- Public read, administrator-only writes. Bucket limits are defense in depth;
-- the browser also validates type and size before upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'council-headshots',
    'council-headshots',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view council headshots" on storage.objects;
create policy "Public can view council headshots"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'council-headshots');

drop policy if exists "Administrators can upload council headshots" on storage.objects;
create policy "Administrators can upload council headshots"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'council-headshots'
    and private.is_site_administrator()
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

drop policy if exists "Administrators can update council headshots" on storage.objects;
create policy "Administrators can update council headshots"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'council-headshots'
    and private.is_site_administrator()
)
with check (
    bucket_id = 'council-headshots'
    and private.is_site_administrator()
    and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp')
);

drop policy if exists "Administrators can delete council headshots" on storage.objects;
create policy "Administrators can delete council headshots"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'council-headshots'
    and private.is_site_administrator()
);
