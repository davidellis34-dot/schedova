alter table public.appointments
  alter column sms_notifications_enabled set default false;

with recipient_delivery as (
  select
    appointment_id,
    bool_or(send_sms) as send_sms
  from public.appointment_message_recipients
  group by appointment_id
),
sms_activity as (
  select
    appointment_id,
    true as has_sms_activity
  from public.sms_message_logs
  where appointment_id is not null
    and direction = 'outbound'
    and message_type in ('confirmation', 'reminder', 'update', 'cancellation')
  group by appointment_id
),
client_sms_eligibility as (
  select
    id as client_id,
    case
      when nullif(trim(coalesce(phone, '')), '') is not null and sms_opt_in = true
        then true
      else false
    end as sms_eligible
  from public.clients
),
sms_backfill as (
  select
    appointments.id,
    coalesce(
      recipient_delivery.send_sms,
      case
        when coalesce(sms_activity.has_sms_activity, false) then true
        when appointments.sms_confirmation_sent_at is not null
          or appointments.sms_reminder_sent_at is not null
          then true
        when appointments.appointment_date >= current_date
          and coalesce(client_sms_eligibility.sms_eligible, false)
          then true
        else false
      end
    ) as sms_enabled
  from public.appointments as appointments
  left join recipient_delivery
    on recipient_delivery.appointment_id = appointments.id
  left join sms_activity
    on sms_activity.appointment_id = appointments.id
  left join client_sms_eligibility
    on client_sms_eligibility.client_id = appointments.client_id
  where appointments.sms_notifications_enabled is null
)
update public.appointments as appointments
set sms_notifications_enabled = sms_backfill.sms_enabled
from sms_backfill
where appointments.id = sms_backfill.id;

update public.appointments
set sms_notifications_enabled = false
where sms_notifications_enabled is null;

alter table public.appointments
  alter column sms_notifications_enabled set not null;

comment on column public.appointments.sms_notifications_enabled is
  'True only when appointment texts are explicitly enabled for this appointment.';
