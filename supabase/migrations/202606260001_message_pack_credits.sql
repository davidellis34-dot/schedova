create extension if not exists pgcrypto;

create table if not exists public.message_credit_balances (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  total_purchased integer not null default 0 check (total_purchased >= 0),
  total_used integer not null default 0 check (total_used >= 0),
  last_purchase_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.message_credit_purchase_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id text not null,
  credits_added integer not null check (credits_added > 0),
  revenuecat_app_user_id text,
  revenuecat_original_app_user_id text,
  revenuecat_transaction_id text not null,
  revenuecat_purchase_token text,
  store text,
  purchased_at timestamptz not null,
  synced_at timestamptz not null default now(),
  raw_transaction jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint message_credit_purchase_ledger_transaction_key unique (
    revenuecat_transaction_id
  )
);

create unique index if not exists message_credit_purchase_ledger_purchase_token_uidx
  on public.message_credit_purchase_ledger (revenuecat_purchase_token)
  where revenuecat_purchase_token is not null;

create index if not exists message_credit_purchase_ledger_user_id_purchased_at_idx
  on public.message_credit_purchase_ledger (user_id, purchased_at desc);

create table if not exists public.message_credit_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid,
  client_id uuid,
  sms_message_log_id uuid references public.sms_message_logs(id) on delete set null,
  message_type text,
  credit_delta integer not null default -1 check (credit_delta = -1),
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'refunded')),
  reservation_reason text not null default 'sms_send',
  reservation_metadata jsonb not null default '{}'::jsonb,
  refund_reason text,
  reserved_at timestamptz not null default now(),
  confirmed_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_credit_usage_events_user_id_reserved_at_idx
  on public.message_credit_usage_events (user_id, reserved_at desc);

create index if not exists message_credit_usage_events_appointment_id_idx
  on public.message_credit_usage_events (appointment_id);

alter table public.message_credit_balances enable row level security;
alter table public.message_credit_purchase_ledger enable row level security;
alter table public.message_credit_usage_events enable row level security;

drop policy if exists "Users can read own message credit balance" on public.message_credit_balances;
create policy "Users can read own message credit balance"
  on public.message_credit_balances
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own message credit purchase ledger" on public.message_credit_purchase_ledger;
create policy "Users can read own message credit purchase ledger"
  on public.message_credit_purchase_ledger
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own message credit usage events" on public.message_credit_usage_events;
create policy "Users can read own message credit usage events"
  on public.message_credit_usage_events
  for select
  using (auth.uid() = user_id);

create or replace function public.claim_message_pack_purchase(
  p_user_id uuid,
  p_product_id text,
  p_revenuecat_transaction_id text,
  p_revenuecat_purchase_token text default null,
  p_purchased_at timestamptz default now(),
  p_revenuecat_app_user_id text default null,
  p_revenuecat_original_app_user_id text default null,
  p_store text default null,
  p_raw_transaction jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits integer := case trim(coalesce(p_product_id, ''))
    when 'message_pack_100' then 100
    when 'message_pack_250' then 250
    when 'message_pack_500' then 500
    else 0
  end;
  v_existing public.message_credit_purchase_ledger%rowtype;
  v_inserted_id uuid;
  v_balance integer := 0;
begin
  if p_user_id is null then
    raise exception 'message pack purchase requires user_id';
  end if;

  if trim(coalesce(p_revenuecat_transaction_id, '')) = '' then
    raise exception 'message pack purchase requires revenuecat_transaction_id';
  end if;

  if v_credits <= 0 then
    return jsonb_build_object(
      'ok', false,
      'applied', false,
      'reason', 'unsupported_product_id',
      'productId', p_product_id
    );
  end if;

  select *
  into v_existing
  from public.message_credit_purchase_ledger
  where revenuecat_transaction_id = p_revenuecat_transaction_id
     or (
       p_revenuecat_purchase_token is not null
       and revenuecat_purchase_token = p_revenuecat_purchase_token
     )
  limit 1;

  if found then
    if v_existing.user_id <> p_user_id then
      return jsonb_build_object(
        'ok', false,
        'applied', false,
        'reason', 'transaction_owned_by_other_user',
        'productId', v_existing.product_id
      );
    end if;

    select balance
    into v_balance
    from public.message_credit_balances
    where user_id = p_user_id;

    return jsonb_build_object(
      'ok', true,
      'applied', false,
      'reason', 'already_processed',
      'productId', v_existing.product_id,
      'creditsAdded', 0,
      'balance', coalesce(v_balance, 0),
      'ledgerId', v_existing.id
    );
  end if;

  insert into public.message_credit_balances (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  begin
    insert into public.message_credit_purchase_ledger (
      user_id,
      product_id,
      credits_added,
      revenuecat_app_user_id,
      revenuecat_original_app_user_id,
      revenuecat_transaction_id,
      revenuecat_purchase_token,
      store,
      purchased_at,
      raw_transaction
    )
    values (
      p_user_id,
      trim(p_product_id),
      v_credits,
      nullif(trim(coalesce(p_revenuecat_app_user_id, '')), ''),
      nullif(trim(coalesce(p_revenuecat_original_app_user_id, '')), ''),
      trim(p_revenuecat_transaction_id),
      nullif(trim(coalesce(p_revenuecat_purchase_token, '')), ''),
      nullif(trim(coalesce(p_store, '')), ''),
      coalesce(p_purchased_at, now()),
      coalesce(p_raw_transaction, '{}'::jsonb)
    )
    returning id
    into v_inserted_id;
  exception
    when unique_violation then
      select *
      into v_existing
      from public.message_credit_purchase_ledger
      where revenuecat_transaction_id = p_revenuecat_transaction_id
         or (
           p_revenuecat_purchase_token is not null
           and revenuecat_purchase_token = p_revenuecat_purchase_token
         )
      limit 1;

      if v_existing.user_id <> p_user_id then
        return jsonb_build_object(
          'ok', false,
          'applied', false,
          'reason', 'transaction_owned_by_other_user',
          'productId', v_existing.product_id
        );
      end if;

      select balance
      into v_balance
      from public.message_credit_balances
      where user_id = p_user_id;

      return jsonb_build_object(
        'ok', true,
        'applied', false,
        'reason', 'already_processed',
        'productId', v_existing.product_id,
        'creditsAdded', 0,
        'balance', coalesce(v_balance, 0),
        'ledgerId', v_existing.id
      );
  end;

  update public.message_credit_balances
  set
    balance = balance + v_credits,
    total_purchased = total_purchased + v_credits,
    last_purchase_at = coalesce(p_purchased_at, now()),
    updated_at = now()
  where user_id = p_user_id
  returning balance into v_balance;

  return jsonb_build_object(
    'ok', true,
    'applied', true,
    'productId', trim(p_product_id),
    'creditsAdded', v_credits,
    'balance', coalesce(v_balance, 0),
    'ledgerId', v_inserted_id
  );
end;
$$;

create or replace function public.reserve_message_credit(
  p_user_id uuid,
  p_appointment_id uuid default null,
  p_client_id uuid default null,
  p_message_type text default null,
  p_sms_message_log_id uuid default null,
  p_reason text default 'sms_send',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer := 0;
  v_event_id uuid;
begin
  if p_user_id is null then
    raise exception 'message credit reservation requires user_id';
  end if;

  insert into public.message_credit_balances (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select balance
  into v_balance
  from public.message_credit_balances
  where user_id = p_user_id
  for update;

  if coalesce(v_balance, 0) <= 0 then
    return jsonb_build_object(
      'ok', false,
      'reserved', false,
      'reason', 'insufficient_credits',
      'balance', coalesce(v_balance, 0)
    );
  end if;

  update public.message_credit_balances
  set
    balance = balance - 1,
    updated_at = now()
  where user_id = p_user_id
  returning balance into v_balance;

  insert into public.message_credit_usage_events (
    user_id,
    appointment_id,
    client_id,
    sms_message_log_id,
    message_type,
    reservation_reason,
    reservation_metadata
  )
  values (
    p_user_id,
    p_appointment_id,
    p_client_id,
    p_sms_message_log_id,
    nullif(trim(coalesce(p_message_type, '')), ''),
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'sms_send'),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'reserved', true,
    'eventId', v_event_id,
    'balance', coalesce(v_balance, 0)
  );
end;
$$;

create or replace function public.confirm_message_credit_reservation(
  p_event_id uuid,
  p_sms_message_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.message_credit_usage_events%rowtype;
  v_balance integer := 0;
begin
  select *
  into v_event
  from public.message_credit_usage_events
  where id = p_event_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'confirmed', false,
      'reason', 'missing_reservation'
    );
  end if;

  select balance
  into v_balance
  from public.message_credit_balances
  where user_id = v_event.user_id;

  if v_event.status = 'confirmed' then
    return jsonb_build_object(
      'ok', true,
      'confirmed', false,
      'reason', 'already_confirmed',
      'balance', coalesce(v_balance, 0),
      'eventId', v_event.id
    );
  end if;

  if v_event.status = 'refunded' then
    return jsonb_build_object(
      'ok', false,
      'confirmed', false,
      'reason', 'already_refunded',
      'balance', coalesce(v_balance, 0),
      'eventId', v_event.id
    );
  end if;

  update public.message_credit_usage_events
  set
    status = 'confirmed',
    sms_message_log_id = coalesce(p_sms_message_log_id, sms_message_log_id),
    confirmed_at = coalesce(confirmed_at, now()),
    updated_at = now()
  where id = p_event_id;

  update public.message_credit_balances
  set
    total_used = total_used + 1,
    last_used_at = now(),
    updated_at = now()
  where user_id = v_event.user_id
  returning balance into v_balance;

  return jsonb_build_object(
    'ok', true,
    'confirmed', true,
    'balance', coalesce(v_balance, 0),
    'eventId', v_event.id
  );
end;
$$;

create or replace function public.refund_message_credit_reservation(
  p_event_id uuid,
  p_refund_reason text default null,
  p_sms_message_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.message_credit_usage_events%rowtype;
  v_balance integer := 0;
begin
  select *
  into v_event
  from public.message_credit_usage_events
  where id = p_event_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'refunded', false,
      'reason', 'missing_reservation'
    );
  end if;

  select balance
  into v_balance
  from public.message_credit_balances
  where user_id = v_event.user_id;

  if v_event.status = 'refunded' then
    return jsonb_build_object(
      'ok', true,
      'refunded', false,
      'reason', 'already_refunded',
      'balance', coalesce(v_balance, 0),
      'eventId', v_event.id
    );
  end if;

  if v_event.status = 'confirmed' then
    return jsonb_build_object(
      'ok', false,
      'refunded', false,
      'reason', 'already_confirmed',
      'balance', coalesce(v_balance, 0),
      'eventId', v_event.id
    );
  end if;

  update public.message_credit_usage_events
  set
    status = 'refunded',
    sms_message_log_id = coalesce(p_sms_message_log_id, sms_message_log_id),
    refund_reason = coalesce(nullif(trim(coalesce(p_refund_reason, '')), ''), refund_reason),
    refunded_at = coalesce(refunded_at, now()),
    updated_at = now()
  where id = p_event_id;

  update public.message_credit_balances
  set
    balance = balance + 1,
    updated_at = now()
  where user_id = v_event.user_id
  returning balance into v_balance;

  return jsonb_build_object(
    'ok', true,
    'refunded', true,
    'balance', coalesce(v_balance, 0),
    'eventId', v_event.id
  );
end;
$$;

revoke all on function public.claim_message_pack_purchase(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.claim_message_pack_purchase(
  uuid,
  text,
  text,
  text,
  timestamptz,
  text,
  text,
  text,
  jsonb
) to service_role;

revoke all on function public.reserve_message_credit(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_message_credit(
  uuid,
  uuid,
  uuid,
  text,
  uuid,
  text,
  jsonb
) to service_role;

revoke all on function public.confirm_message_credit_reservation(
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function public.confirm_message_credit_reservation(
  uuid,
  uuid
) to service_role;

revoke all on function public.refund_message_credit_reservation(
  uuid,
  text,
  uuid
) from public, anon, authenticated;
grant execute on function public.refund_message_credit_reservation(
  uuid,
  text,
  uuid
) to service_role;
