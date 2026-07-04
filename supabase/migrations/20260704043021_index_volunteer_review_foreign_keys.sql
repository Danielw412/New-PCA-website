create index volunteer_applications_reviewer_idx
    on public.volunteer_applications (reviewed_by)
    where reviewed_by is not null;

create index volunteer_assignments_assigner_idx
    on public.volunteer_assignments (assigned_by);

create index volunteer_hours_reviewer_idx
    on public.volunteer_hours (reviewed_by)
    where reviewed_by is not null;
