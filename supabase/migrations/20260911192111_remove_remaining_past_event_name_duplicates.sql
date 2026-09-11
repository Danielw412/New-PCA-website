-- Apply the same one-name/one-card rule to older past rows that were outside
-- the initial historical import window. The latest dated row remains visible.
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
      and event_date < current_date
)
update public.events as events
set
    published = false,
    registration_open = false,
    deleted_at = now()
from ranked_events
where events.id = ranked_events.id
  and ranked_events.name_rank > 1;
