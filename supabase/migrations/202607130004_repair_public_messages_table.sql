create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  conversation_id uuid,
  contact_id uuid,
  channel text not null check (channel in ('sms', 'email')),
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text,
  recipient text,
  subject text,
  body text not null,
  status text not null default 'queued',
  provider_message_id text,
  provider text,
  error_message text,
  provider_response jsonb,
  read_at timestamptz,
  resolved_at timestamptz,
  needs_attention boolean not null default false,
  attention_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messages
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists account_id uuid references auth.users(id) on delete cascade,
  add column if not exists client_id uuid references public.clients(id) on delete set null,
  add column if not exists appointment_id uuid references public.appointments(id) on delete set null,
  add column if not exists conversation_id uuid,
  add column if not exists contact_id uuid,
  add column if not exists channel text,
  add column if not exists direction text,
  add column if not exists sender text,
  add column if not exists recipient text,
  add column if not exists subject text,
  add column if not exists body text,
  add column if not exists status text,
  add column if not exists provider_message_id text,
  add column if not exists provider text,
  add column if not exists error_message text,
  add column if not exists provider_response jsonb,
  add column if not exists read_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists needs_attention boolean,
  add column if not exists attention_reason text,
  add column if not exists metadata jsonb,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

update public.messages
set user_id = coalesce(user_id, account_id)
where user_id is null
  and account_id is not null;

update public.messages
set account_id = coalesce(account_id, user_id)
where account_id is null
  and user_id is not null;

update public.messages
set channel = 'sms'
where channel is null;

update public.messages
set direction = 'outbound'
where direction is null;

update public.messages
set body = ''
where body is null;

update public.messages
set status = 'queued'
where status is null;

update public.messages
set needs_attention = false
where needs_attention is null;

update public.messages
set metadata = '{}'::jsonb
where metadata is null;

update public.messages
set created_at = now()
where created_at is null;

update public.messages
set updated_at = now()
where updated_at is null;

alter table public.messages
  alter column channel set default 'sms',
  alter column direction set default 'outbound',
  alter column status set default 'queued',
  alter column body set default '',
  alter column needs_attention set default false,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now(),
  alter column updated_at set default now();

do $$
begin
  if not exists (
    select 1
    from public.messages
    where user_id is null
  ) then
    alter table public.messages alter column user_id set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where channel is null
  ) then
    alter table public.messages alter column channel set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where direction is null
  ) then
    alter table public.messages alter column direction set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where body is null
  ) then
    alter table public.messages alter column body set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where status is null
  ) then
    alter table public.messages alter column status set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where created_at is null
  ) then
    alter table public.messages alter column created_at set not null;
  end if;

  if not exists (
    select 1
    from public.messages
    where updated_at is null
  ) then
    alter table public.messages alter column updated_at set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_channel_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_channel_check
      check (channel in ('sms', 'email'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'messages_direction_check'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table public.messages
      add constraint messages_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;
end $$;

create or replace function public.sync_message_owner_columns()
returns trigger
language plpgsql
as $$
begin
  new.user_id := coalesce(new.user_id, new.account_id);
  new.account_id := coalesce(new.account_id, new.user_id);
  new.channel := coalesce(new.channel, 'sms');
  new.direction := coalesce(new.direction, 'outbound');
  new.body := coalesce(new.body, '');
  new.status := coalesce(new.status, 'queued');
  new.needs_attention := coalesce(new.needs_attention, false);
  new.metadata := coalesce(new.metadata, '{}'::jsonb);
  new.created_at := coalesce(new.created_at, now());
  new.updated_at := coalesce(new.updated_at, now());

  if new.user_id is null then
    raise exception 'messages.user_id is required';
  end if;

  return new;
end;
$$;

drop trigger if exists messages_sync_owner_columns on public.messages;
create trigger messages_sync_owner_columns
  before insert or update on public.messages
  for each row
  execute function public.sync_message_owner_columns();

create or replace function public.touch_message_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists messages_touch_updated_at on public.messages;
create trigger messages_touch_updated_at
  before update on public.messages
  for each row
  execute function public.touch_message_updated_at();

create index if not exists messages_user_id_created_at_idx
  on public.messages (user_id, created_at desc);

create index if not exists messages_account_id_created_at_idx
  on public.messages (account_id, created_at desc);

create index if not exists messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at desc);

create index if not exists messages_client_id_created_at_idx
  on public.messages (client_id, created_at desc);

create index if not exists messages_provider_message_id_idx
  on public.messages (provider_message_id);

create unique index if not exists messages_provider_message_id_unique_idx
  on public.messages (provider_message_id)
  where provider_message_id is not null;

alter table public.messages enable row level security;

drop policy if exists "Users can select own messages" on public.messages;
create policy "Users can select own messages"
  on public.messages
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own messages" on public.messages;
create policy "Users can insert own messages"
  on public.messages
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own messages" on public.messages;
create policy "Users can update own messages"
  on public.messages
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own messages" on public.messages;
create policy "Users can delete own messages"
  on public.messages
  for delete
  using (auth.uid() = user_id);

notify pgrst, 'reload schema';
