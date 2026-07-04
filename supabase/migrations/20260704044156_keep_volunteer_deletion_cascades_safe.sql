drop policy "Admins can delete volunteer assignments"
on public.volunteer_assignments;

revoke delete on table public.volunteer_assignments from authenticated;

alter table public.volunteer_hours
    drop constraint volunteer_hours_assignment_id_fkey,
    add constraint volunteer_hours_assignment_id_fkey
        foreign key (assignment_id)
        references public.volunteer_assignments (id)
        on delete cascade;

comment on constraint volunteer_hours_assignment_id_fkey on public.volunteer_hours is
    'Deletes hour records only when their assignment is removed by an account-deletion cascade; browser roles cannot delete assignments.';
