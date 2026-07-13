create extension if not exists pgcrypto;

create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text not null,
  category text,
  source text not null default 'custom',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_templates_source_check
    check (source in ('custom'))
);

comment on table public.message_templates is
  'User-owned reusable appointment message templates. Built-in starter templates are local app defaults.';

create index if not exists message_templates_user_id_created_at_idx
  on public.message_templates (user_id, created_at desc);

alter table public.message_templates enable row level security;

drop policy if exists "Users can read own message templates" on public.message_templates;
create policy "Users can read own message templates"
  on public.message_templates
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own message templates" on public.message_templates;
create policy "Users can create own message templates"
  on public.message_templates
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own message templates" on public.message_templates;
create policy "Users can update own message templates"
  on public.message_templates
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own message templates" on public.message_templates;
create policy "Users can delete own message templates"
  on public.message_templates
  for delete
  using (auth.uid() = user_id);
