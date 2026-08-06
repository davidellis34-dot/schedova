-- Smart Reminders foundation and secure feedback persistence.
-- The mobile feature flag remains off until this migration and the feedback
-- Edge Function have been deployed and verified.

alter table public.services
  add column if not exists rebooking_interval_value integer,
  add column if not exists rebooking_interval_unit text;

alter table public.services
  drop constraint if exists services_rebooking_interval_value_check;

alter table public.services
  add constraint services_rebooking_interval_value_check
  check (rebooking_interval_value is null or rebooking_interval_value > 0);

alter table public.services
  drop constraint if exists services_rebooking_interval_unit_check;

alter table public.services
  add constraint services_rebooking_interval_unit_check
  check (
    rebooking_interval_unit is null
    or rebooking_interval_unit in ('days', 'weeks', 'months')
  );

alter table public.services
  drop constraint if exists services_rebooking_interval_complete_check;

alter table public.services
  add constraint services_rebooking_interval_complete_check
  check (
    (rebooking_interval_value is null and rebooking_interval_unit is null)
    or (rebooking_interval_value is not null and rebooking_interval_unit is not null)
  );

create table if not exists public.smart_reminder_dismissals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  service_id uuid not null references public.services(id) on delete cascade,
  due_on date not null,
  action text not null check (action in ('dismissed', 'remind_later', 'sending', 'sent')),
  remind_after timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id, service_id, due_on)
);

create index if not exists smart_reminder_dismissals_user_due_on_idx
  on public.smart_reminder_dismissals (user_id, due_on desc);

alter table public.smart_reminder_dismissals enable row level security;

drop policy if exists "Users manage own smart reminder dismissals" on public.smart_reminder_dismissals;
create policy "Users manage own smart reminder dismissals"
  on public.smart_reminder_dismissals
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.feedback_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  feedback_type text not null,
  title text not null,
  description text not null,
  submission_key text not null,
  metadata jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, submission_key)
);

create index if not exists feedback_submissions_user_created_at_idx
  on public.feedback_submissions (user_id, created_at desc);

-- Feedback is submitted only through the authenticated Edge Function. There
-- is deliberately no direct client policy for this table.
alter table public.feedback_submissions enable row level security;
