create extension if not exists pgcrypto;

create table if not exists public.user_message_credits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  credits_remaining integer not null default 0 check (credits_remaining >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_message_credits is
  'Persistent SMS/message credit balance for consumable RevenueCat message packs.';

create table if not exists public.message_credit_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revenuecat_transaction_id text not null,
  product_identifier text not null,
  package_identifier text,
  platform text not null,
  credits_added integer not null check (credits_added > 0),
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (revenuecat_transaction_id)
);

comment on table public.message_credit_purchases is
  'RevenueCat consumable purchase ledger. Unique transaction IDs prevent double-crediting.';

create table if not exists public.message_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  appointment_id uuid,
  sms_message_log_id uuid references public.sms_message_logs(id) on delete set null,
  purchase_id uuid references public.message_credit_purchases(id) on delete set null,
  delta integer not null,
  reason text not null,
  provider_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.message_credit_ledger is
  'Audit ledger for message credit additions and deductions.';

create index if not exists user_message_credits_user_id_idx
  on public.user_message_credits (user_id);

create index if not exists message_credit_purchases_user_id_created_at_idx
  on public.message_credit_purchases (user_id, created_at desc);

create index if not exists message_credit_ledger_user_id_created_at_idx
  on public.message_credit_ledger (user_id, created_at desc);

alter table public.user_message_credits enable row level security;
alter table public.message_credit_purchases enable row level security;
alter table public.message_credit_ledger enable row level security;

drop policy if exists "Users can read own message credits" on public.user_message_credits;
create policy "Users can read own message credits"
  on public.user_message_credits
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own message credit purchases" on public.message_credit_purchases;
create policy "Users can read own message credit purchases"
  on public.message_credit_purchases
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can read own message credit ledger" on public.message_credit_ledger;
create policy "Users can read own message credit ledger"
  on public.message_credit_ledger
  for select
  using (auth.uid() = user_id);

create or replace function public.credit_message_pack_purchase(
  p_user_id uuid,
  p_revenuecat_transaction_id text,
  p_product_identifier text,
  p_package_identifier text,
  p_platform text,
  p_credits integer,
  p_provider_response jsonb default '{}'::jsonb
)
returns table (
  credits_remaining integer,
  purchase_created boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_purchase_id uuid;
  v_purchase_created boolean := false;
  v_credits_remaining integer := 0;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  if coalesce(trim(p_revenuecat_transaction_id), '') = '' then
    raise exception 'missing_revenuecat_transaction_id';
  end if;

  if p_credits <= 0 then
    raise exception 'invalid_credit_amount';
  end if;

  insert into public.message_credit_purchases (
    user_id,
    revenuecat_transaction_id,
    product_identifier,
    package_identifier,
    platform,
    credits_added,
    provider_response
  )
  values (
    p_user_id,
    p_revenuecat_transaction_id,
    p_product_identifier,
    p_package_identifier,
    p_platform,
    p_credits,
    coalesce(p_provider_response, '{}'::jsonb)
  )
  on conflict (revenuecat_transaction_id) do nothing
  returning id into v_purchase_id;

  v_purchase_created := v_purchase_id is not null;

  if v_purchase_created then
    insert into public.user_message_credits (
      user_id,
      credits_remaining,
      updated_at
    )
    values (
      p_user_id,
      p_credits,
      now()
    )
    on conflict (user_id) do update
      set credits_remaining =
            public.user_message_credits.credits_remaining + excluded.credits_remaining,
          updated_at = now()
    returning public.user_message_credits.credits_remaining
      into v_credits_remaining;

    insert into public.message_credit_ledger (
      user_id,
      purchase_id,
      delta,
      reason,
      metadata
    )
    values (
      p_user_id,
      v_purchase_id,
      p_credits,
      'message_pack_purchase',
      jsonb_build_object(
        'product_identifier', p_product_identifier,
        'package_identifier', p_package_identifier,
        'platform', p_platform
      )
    );
  else
    select coalesce(credits_remaining, 0)
      into v_credits_remaining
      from public.user_message_credits
      where user_id = p_user_id;

    v_credits_remaining := coalesce(v_credits_remaining, 0);
  end if;

  return query select v_credits_remaining, v_purchase_created;
end;
$$;

create or replace function public.consume_message_credit_for_sms(
  p_user_id uuid,
  p_appointment_id uuid,
  p_sms_message_log_id uuid,
  p_provider_message_id text,
  p_metadata jsonb default '{}'::jsonb
)
returns table (
  credits_remaining integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_credits_remaining integer;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  update public.user_message_credits
    set credits_remaining = credits_remaining - 1,
        updated_at = now()
    where user_id = p_user_id
      and credits_remaining > 0
    returning public.user_message_credits.credits_remaining
      into v_credits_remaining;

  if v_credits_remaining is null then
    raise exception 'message_credits_empty';
  end if;

  insert into public.message_credit_ledger (
    user_id,
    appointment_id,
    sms_message_log_id,
    delta,
    reason,
    provider_message_id,
    metadata
  )
  values (
    p_user_id,
    p_appointment_id,
    p_sms_message_log_id,
    -1,
    'sms_send',
    p_provider_message_id,
    coalesce(p_metadata, '{}'::jsonb)
  );

  return query select v_credits_remaining;
end;
$$;

revoke all on function public.credit_message_pack_purchase(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  jsonb
) from public, anon, authenticated;

revoke all on function public.consume_message_credit_for_sms(
  uuid,
  uuid,
  uuid,
  text,
  jsonb
) from public, anon, authenticated;

grant execute on function public.credit_message_pack_purchase(
  uuid,
  text,
  text,
  text,
  text,
  integer,
  jsonb
) to service_role;

grant execute on function public.consume_message_credit_for_sms(
  uuid,
  uuid,
  uuid,
  text,
  jsonb
) to service_role;
