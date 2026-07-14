alter table public.appointments
  add column if not exists is_double_booked boolean not null default false,
  add column if not exists double_booked_with uuid[] null,
  add column if not exists double_booking_confirmed_at timestamptz null;

create index if not exists appointments_user_double_booked_idx
  on public.appointments (user_id, appointment_date)
  where is_double_booked = true;

comment on column public.appointments.is_double_booked is
  'True when the business intentionally saved an appointment that overlaps another appointment.';

comment on column public.appointments.double_booked_with is
  'Appointment IDs that overlapped when the double booking was confirmed.';

comment on column public.appointments.double_booking_confirmed_at is
  'Timestamp when the double booking warning was confirmed.';
