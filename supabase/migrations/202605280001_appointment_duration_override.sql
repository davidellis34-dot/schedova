alter table public.appointments
  add column if not exists duration_minutes integer;

comment on column public.appointments.duration_minutes is
  'Appointment-level booked duration in minutes. Defaults from selected services but can be overridden per appointment.';
