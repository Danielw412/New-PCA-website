alter table public.volunteer_applications
    drop constraint volunteer_application_review_shape,
    add constraint volunteer_application_review_shape check (
        (
            status = 'pending'
            and reviewed_by is null
            and reviewed_at is null
        )
        or
        (
            status in ('approved', 'rejected')
            and reviewed_at is not null
        )
    );

alter table public.volunteer_hours
    drop constraint volunteer_hours_review_shape,
    add constraint volunteer_hours_review_shape check (
        (
            status = 'submitted'
            and approved_hours is null
            and reviewed_by is null
            and reviewed_at is null
        )
        or
        (
            status = 'approved'
            and approved_hours between 0.25 and submitted_hours
            and reviewed_at is not null
        )
        or
        (
            status = 'rejected'
            and approved_hours is null
            and reviewed_at is not null
        )
    );

alter table public.volunteer_assignments
    drop constraint volunteer_assignments_assigned_by_fkey,
    alter column assigned_by drop not null,
    add constraint volunteer_assignments_assigned_by_fkey
        foreign key (assigned_by)
        references public.profiles (id)
        on delete set null;

comment on column public.volunteer_applications.reviewed_by is
    'The reviewing administrator. May be null later if that administrator deletes their account.';
comment on column public.volunteer_assignments.assigned_by is
    'The assigning administrator. May be null later if that administrator deletes their account.';
comment on column public.volunteer_hours.reviewed_by is
    'The reviewing administrator. May be null later if that administrator deletes their account.';
