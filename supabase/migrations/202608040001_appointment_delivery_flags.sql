alter table public.appointments
  add column if not exists sms_notifications_enabled boolean,
  add column if not exists email_notifications_enabled boolean;

with recipient_delivery as (
  select
    appointment_id,
    bool_or(send_sms) as send_sms,
    bool_or(send_email) as send_email
  from public.appointment_message_recipients
  group by appointment_id
)
update public.appointments as appointments
set
  sms_notifications_enabled = recipient_delivery.send_sms,
  email_notifications_enabled = recipient_delivery.send_email
from recipient_delivery
where appointments.id = recipient_delivery.appointment_id
  and (
    appointments.sms_notifications_enabled is null
    or appointments.email_notifications_enabled is null
  );

comment on column public.appointments.sms_notifications_enabled is
  'Whether appointment texts are enabled for this appointment.';

comment on column public.appointments.email_notifications_enabled is
  'Whether appointment emails are enabled for this appointment.';
