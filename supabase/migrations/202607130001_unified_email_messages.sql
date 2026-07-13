create table if not exists public.message_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  subject text,
  latest_message_at timestamptz,
  latest_message_preview text,
  latest_channel text,
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_conversations_channel_check
    check (latest_channel is null or latest_channel in ('sms', 'email'))
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  conversation_id uuid references public.message_conversations(id) on delete set null,
  channel text not null check (channel in ('sms', 'email')),
  direction text not null check (direction in ('inbound', 'outbound')),
  sender text,
  recipient text,
  subject text,
  body text,
  status text,
  provider text,
  provider_message_id text,
  provider_response jsonb,
  read_at timestamptz,
  resolved_at timestamptz,
  needs_attention boolean not null default false,
  attention_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_reply_tokens (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  account_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  appointment_id uuid references public.appointments(id) on delete set null,
  conversation_id uuid references public.message_conversations(id) on delete cascade,
  message_type text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_provider_message_id_uidx
  on public.messages (provider, provider_message_id)
  where provider_message_id is not null;

create index if not exists messages_account_channel_created_at_idx
  on public.messages (account_id, channel, created_at desc);

create index if not exists messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at asc);

create index if not exists messages_account_unread_idx
  on public.messages (account_id, read_at, created_at desc)
  where direction = 'inbound';

create index if not exists message_conversations_account_latest_idx
  on public.message_conversations (account_id, latest_message_at desc);

create index if not exists email_reply_tokens_account_client_idx
  on public.email_reply_tokens (account_id, client_id, created_at desc);

alter table public.message_conversations enable row level security;
alter table public.messages enable row level security;
alter table public.email_reply_tokens enable row level security;

drop policy if exists "Users can read own message conversations" on public.message_conversations;
create policy "Users can read own message conversations"
  on public.message_conversations
  for select
  using (auth.uid() = account_id);

drop policy if exists "Users can update own message conversations" on public.message_conversations;
create policy "Users can update own message conversations"
  on public.message_conversations
  for update
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

drop policy if exists "Users can read own messages" on public.messages;
create policy "Users can read own messages"
  on public.messages
  for select
  using (auth.uid() = account_id);

drop policy if exists "Users can update own messages" on public.messages;
create policy "Users can update own messages"
  on public.messages
  for update
  using (auth.uid() = account_id)
  with check (auth.uid() = account_id);

drop policy if exists "Users can read own email reply tokens" on public.email_reply_tokens;
create policy "Users can read own email reply tokens"
  on public.email_reply_tokens
  for select
  using (auth.uid() = account_id);

alter table public.appointment_message_deliveries
  add column if not exists channel text not null default 'sms',
  add column if not exists conversation_id uuid references public.message_conversations(id) on delete set null;

alter table public.appointments
  add column if not exists email_confirmation_sent_at timestamptz,
  add column if not exists email_reminder_sent_at timestamptz;

create or replace function public.upsert_message_conversation(
  p_account_id uuid,
  p_client_id uuid,
  p_appointment_id uuid,
  p_subject text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
begin
  if p_account_id is null then
    raise exception 'conversation requires account_id';
  end if;

  select id
  into v_conversation_id
  from public.message_conversations
  where account_id = p_account_id
    and coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(p_client_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and coalesce(appointment_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(p_appointment_id, '00000000-0000-0000-0000-000000000000'::uuid)
  order by updated_at desc
  limit 1;

  if v_conversation_id is null then
    insert into public.message_conversations (
      account_id,
      client_id,
      appointment_id,
      subject
    )
    values (
      p_account_id,
      p_client_id,
      p_appointment_id,
      nullif(trim(coalesce(p_subject, '')), '')
    )
    returning id into v_conversation_id;
  elsif nullif(trim(coalesce(p_subject, '')), '') is not null then
    update public.message_conversations
    set subject = coalesce(subject, nullif(trim(p_subject), '')),
        updated_at = now()
    where id = v_conversation_id;
  end if;

  return v_conversation_id;
end;
$$;

create or replace function public.refresh_message_conversation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_preview text;
begin
  if new.conversation_id is null then
    new.conversation_id := public.upsert_message_conversation(
      new.account_id,
      new.client_id,
      new.appointment_id,
      new.subject
    );
  end if;

  v_preview := left(regexp_replace(coalesce(new.body, ''), '\s+', ' ', 'g'), 160);

  update public.message_conversations
  set latest_message_at = coalesce(new.created_at, now()),
      latest_message_preview = v_preview,
      latest_channel = new.channel,
      unread_count = (
        select count(*)::integer
        from public.messages
        where conversation_id = new.conversation_id
          and direction = 'inbound'
          and read_at is null
      ) + case
        when new.direction = 'inbound' and new.read_at is null then 1
        else 0
      end,
      updated_at = now()
  where id = new.conversation_id;

  return new;
end;
$$;

drop trigger if exists messages_refresh_conversation_before_insert on public.messages;
create trigger messages_refresh_conversation_before_insert
  before insert on public.messages
  for each row
  execute function public.refresh_message_conversation();

create or replace function public.refresh_message_conversation_after_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is not null then
    update public.message_conversations
    set unread_count = (
          select count(*)::integer
          from public.messages
          where conversation_id = new.conversation_id
            and direction = 'inbound'
            and read_at is null
        ),
        updated_at = now()
    where id = new.conversation_id;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_refresh_conversation_after_update on public.messages;
create trigger messages_refresh_conversation_after_update
  after update of read_at, resolved_at on public.messages
  for each row
  execute function public.refresh_message_conversation_after_update();

create or replace function public.mirror_sms_log_to_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id uuid;
  v_direction text;
  v_appointment_id uuid;
  v_client_id uuid;
begin
  v_direction := case
    when new.direction in ('inbound', 'outbound') then new.direction
    else 'outbound'
  end;

  select id
  into v_appointment_id
  from public.appointments
  where id = new.appointment_id
  limit 1;

  select id
  into v_client_id
  from public.clients
  where id = new.client_id
  limit 1;

  v_conversation_id := public.upsert_message_conversation(
    new.user_id,
    v_client_id,
    v_appointment_id,
    null
  );

  insert into public.messages (
    id,
    account_id,
    client_id,
    appointment_id,
    conversation_id,
    channel,
    direction,
    sender,
    recipient,
    subject,
    body,
    status,
    provider,
    provider_message_id,
    provider_response,
    read_at,
    resolved_at,
    needs_attention,
    attention_reason,
    metadata,
    created_at,
    updated_at
  )
  values (
    new.id,
    new.user_id,
    v_client_id,
    v_appointment_id,
    v_conversation_id,
    'sms',
    v_direction,
    new.from_number,
    coalesce(new.to_number, new.to_phone),
    null,
    coalesce(new.message_body, new.body),
    new.status,
    coalesce(new.provider, 'telnyx'),
    new.provider_message_id,
    new.provider_response,
    new.read_at,
    new.resolved_at,
    coalesce(new.needs_attention, false),
    new.attention_reason,
    jsonb_build_object('sms_message_log_id', new.id, 'message_type', new.message_type),
    coalesce(new.created_at, now()),
    now()
  )
  on conflict (id) do update
  set body = excluded.body,
      status = excluded.status,
      provider_message_id = excluded.provider_message_id,
      provider_response = excluded.provider_response,
      read_at = excluded.read_at,
      resolved_at = excluded.resolved_at,
      needs_attention = excluded.needs_attention,
      attention_reason = excluded.attention_reason,
      updated_at = now();

  return new;
end;
$$;

drop trigger if exists sms_message_logs_mirror_to_messages on public.sms_message_logs;
create trigger sms_message_logs_mirror_to_messages
  after insert or update on public.sms_message_logs
  for each row
  execute function public.mirror_sms_log_to_message();

insert into public.messages (
  id,
  account_id,
  client_id,
  appointment_id,
  channel,
  direction,
  sender,
  recipient,
  body,
  status,
  provider,
  provider_message_id,
  provider_response,
  read_at,
  resolved_at,
  needs_attention,
  attention_reason,
  metadata,
  created_at,
  updated_at
)
select
  id,
  user_id,
  case
    when client_id is not null
      and exists (
        select 1
        from public.clients
        where clients.id = sms_message_logs.client_id
      )
      then client_id
    else null
  end,
  case
    when appointment_id is not null
      and exists (
        select 1
        from public.appointments
        where appointments.id = sms_message_logs.appointment_id
      )
      then appointment_id
    else null
  end,
  'sms',
  case when direction in ('inbound', 'outbound') then direction else 'outbound' end,
  from_number,
  coalesce(to_number, to_phone),
  coalesce(message_body, body),
  status,
  coalesce(provider, 'telnyx'),
  provider_message_id,
  provider_response,
  read_at,
  resolved_at,
  coalesce(needs_attention, false),
  attention_reason,
  jsonb_build_object('sms_message_log_id', id, 'message_type', message_type),
  created_at,
  now()
from public.sms_message_logs
where user_id is not null
on conflict (id) do nothing;

grant execute on function public.upsert_message_conversation(uuid, uuid, uuid, text) to authenticated, service_role;
