-- Keep one published historical record for each exact event name. When the
-- same named event appears more than once, the most recent dated record is the
-- canonical entry; this also keeps the archive's year placement deterministic.
with ranked_events as (
    select
        id,
        row_number() over (
            partition by lower(btrim(title))
            order by event_date desc, created_at desc, id desc
        ) as name_rank
    from public.events
    where published = true
      and deleted_at is null
      and event_date between date '2023-09-01' and date '2025-08-31'
)
update public.events as events
set
    published = false,
    registration_open = false,
    deleted_at = now()
from ranked_events
where events.id = ranked_events.id
  and ranked_events.name_rank > 1;
