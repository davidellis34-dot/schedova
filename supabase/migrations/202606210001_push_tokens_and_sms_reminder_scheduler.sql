create extension if not exists pgcrypto;
create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.app_secrets is
  'Server-only configuration values read by scheduled database jobs.';

alter table private.app_secrets enable row level security;

revoke all on table private.app_secrets from public;
revoke all on table private.app_secrets from anon;
revoke all on table private.app_secrets from authenticated;

create table if not exists public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null,
  platform text,
  device_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint user_push_tokens_user_token_unique unique (user_id, expo_push_token)
);

comment on table public.user_push_tokens is
  'Expo push tokens for notifying business owners about inbound client replies.';

create index if not exists user_push_tokens_user_id_last_seen_idx
  on public.user_push_tokens (user_id, last_seen_at desc);

alter table public.user_push_tokens enable row level security;

drop policy if exists "Users can read own push tokens" on public.user_push_tokens;
create policy "Users can read own push tokens"
  on public.user_push_tokens
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own push tokens" on public.user_push_tokens;
create policy "Users can create own push tokens"
  on public.user_push_tokens
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own push tokens" on public.user_push_tokens;
create policy "Users can update own push tokens"
  on public.user_push_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own push tokens" on public.user_push_tokens;
create policy "Users can delete own push tokens"
  on public.user_push_tokens
  for delete
  using (auth.uid() = user_id);

alter table public.user_settings
  add column if not exists timezone text;

comment on column public.user_settings.timezone is
  'IANA timezone used by automatic SMS reminder scheduling.';

alter table public.appointments
  add column if not exists reminder_sent_at timestamptz,
  add column if not exists reminder_last_attempt_at timestamptz,
  add column if not exists reminder_last_error text;

create index if not exists appointments_due_sms_reminders_idx
  on public.appointments (user_id, appointment_date, appointment_time)
  where reminder_sent_at is null
    and coalesce(status, 'scheduled') not in (
      'canceled',
      'cancelled',
      'business_canceled',
      'business_cancelled',
      'customer_canceled',
      'customer_cancelled',
      'completed',
      'no_show'
    );

comment on column public.appointments.reminder_sent_at is
  'Set after the automatic SMS reminder worker successfully sends a reminder.';

comment on column public.appointments.reminder_last_attempt_at is
  'Last time the automatic SMS reminder worker attempted this appointment.';

comment on column public.appointments.reminder_last_error is
  'Friendly/internal error code from the last automatic SMS reminder attempt.';

create table if not exists public.appointment_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid,
  message_type text not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status text not null default 'pending',
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_message_deliveries_unique unique (
    appointment_id,
    message_type,
    scheduled_for
  )
);

create index if not exists appointment_message_deliveries_user_status_idx
  on public.appointment_message_deliveries (user_id, status, scheduled_for desc);

alter table public.appointment_message_deliveries enable row level security;

drop policy if exists "Users can read own appointment message deliveries" on public.appointment_message_deliveries;
create policy "Users can read own appointment message deliveries"
  on public.appointment_message_deliveries
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can update own appointment message deliveries" on public.appointment_message_deliveries;
create policy "Users can update own appointment message deliveries"
  on public.appointment_message_deliveries
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

do $$
begin
  perform cron.unschedule('schedova-send-due-appointment-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'schedova-send-due-appointment-reminders',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url := 'https://tzbnnmjogxidyltanufu.supabase.co/functions/v1/send-due-appointment-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-schedova-cron-secret', coalesce(
          (
            select value
            from private.app_secrets
            where key = 'reminder_cron_secret'
          ),
          ''
        )
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'requested_at', now()
      ),
      timeout_milliseconds := 30000
    );
  $$
);
