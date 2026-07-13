create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_name text not null,
  relationship text,
  phone text,
  email text,
  sms_enabled boolean not null default false,
  email_enabled boolean not null default false,
  sms_consent_at timestamptz,
  email_consent_at timestamptz,
  sms_unsubscribed_at timestamptz,
  email_unsubscribed_at timestamptz,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_contacts_has_contact check (
    nullif(trim(coalesce(phone, '')), '') is not null
    or nullif(trim(coalesce(email, '')), '') is not null
  )
);

create table if not exists public.appointment_message_recipients (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  client_contact_id uuid references public.client_contacts(id) on delete set null,
  contact_name text,
  relationship text,
  phone text,
  email text,
  send_sms boolean not null default false,
  send_email boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint appointment_message_recipients_unique unique (
    appointment_id,
    client_contact_id
  )
);

create table if not exists public.communication_consent_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_contact_id uuid references public.client_contacts(id) on delete cascade,
  requested_sms boolean not null default false,
  requested_email boolean not null default false,
  sent_to_phone text,
  sent_to_email text,
  approved_sms_at timestamptz,
  approved_email_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create index if not exists client_contacts_user_client_idx
  on public.client_contacts (user_id, client_id, created_at asc);

create index if not exists appointment_message_recipients_appointment_idx
  on public.appointment_message_recipients (appointment_id, send_sms, send_email);

create index if not exists communication_consent_tokens_token_idx
  on public.communication_consent_tokens (token);

alter table public.client_contacts enable row level security;
alter table public.appointment_message_recipients enable row level security;
alter table public.communication_consent_tokens enable row level security;

drop policy if exists "Users can manage own client contacts" on public.client_contacts;
create policy "Users can manage own client contacts"
  on public.client_contacts
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can manage own appointment message recipients" on public.appointment_message_recipients;
create policy "Users can manage own appointment message recipients"
  on public.appointment_message_recipients
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own communication consent tokens" on public.communication_consent_tokens;
create policy "Users can read own communication consent tokens"
  on public.communication_consent_tokens
  for select
  using (auth.uid() = user_id);

create or replace function public.touch_client_contact_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists client_contacts_touch_updated_at on public.client_contacts;
create trigger client_contacts_touch_updated_at
  before update on public.client_contacts
  for each row
  execute function public.touch_client_contact_updated_at();
