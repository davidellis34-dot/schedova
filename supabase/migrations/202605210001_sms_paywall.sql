create extension if not exists pgcrypto;

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'inactive',
  plan text not null default 'free',
  current_period_end timestamptz,
  entitlement text,
  entitlement_source text,
  entitlement_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_subscriptions is
  'Manual Pro entitlement table for launch testing. Paid subscriptions are not enabled in-app yet.';

alter table public.clients
  add column if not exists sms_opt_in boolean not null default false;

alter table public.clients
  add column if not exists sms_opt_in_at timestamptz;

alter table public.clients
  add column if not exists sms_opt_in_source text;

comment on column public.clients.sms_opt_in is
  'True only when the client agreed to receive appointment text messages.';

create table if not exists public.sms_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  appointment_confirmations_enabled boolean not null default true,
  appointment_updates_enabled boolean not null default true,
  appointment_cancellations_enabled boolean not null default true,
  appointment_reminders_enabled boolean not null default true,
  reminder_hours_before integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sms_message_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid,
  client_id uuid,
  message_type text not null,
  to_phone text,
  body text,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists sms_message_logs_user_id_created_at_idx
  on public.sms_message_logs (user_id, created_at desc);

alter table public.user_subscriptions enable row level security;
alter table public.sms_settings enable row level security;
alter table public.sms_message_logs enable row level security;

drop policy if exists "Users can read own subscription" on public.user_subscriptions;
create policy "Users can read own subscription"
  on public.user_subscriptions
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own sms settings" on public.sms_settings;
create policy "Users can read own sms settings"
  on public.sms_settings
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own sms settings" on public.sms_settings;
create policy "Users can create own sms settings"
  on public.sms_settings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own sms settings" on public.sms_settings;
create policy "Users can update own sms settings"
  on public.sms_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own sms settings" on public.sms_settings;
create policy "Users can delete own sms settings"
  on public.sms_settings
  for delete
  using (auth.uid() = user_id);

drop policy if exists "Users can read own sms logs" on public.sms_message_logs;
create policy "Users can read own sms logs"
  on public.sms_message_logs
  for select
  using (auth.uid() = user_id);
