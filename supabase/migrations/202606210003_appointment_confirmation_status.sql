alter table public.appointments
  add column if not exists confirmation_status text,
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmation_response_at timestamptz;

comment on column public.appointments.confirmation_status is
  'Client response state for SMS confirmations and reminders, separate from the appointment lifecycle status.';

comment on column public.appointments.confirmed_at is
  'When the client confirmed the appointment by SMS or another confirmation flow.';

comment on column public.appointments.confirmation_response_at is
  'When the latest client confirmation or reschedule response was received.';

create index if not exists appointments_user_confirmation_status_idx
  on public.appointments (user_id, confirmation_status);
