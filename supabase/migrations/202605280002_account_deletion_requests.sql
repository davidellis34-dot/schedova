create extension if not exists pgcrypto;

create table if not exists public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  requested_from text not null default 'app',
  status text not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists account_deletion_requests_user_id_created_at_idx
  on public.account_deletion_requests (user_id, created_at desc);

alter table public.account_deletion_requests enable row level security;

drop policy if exists "Users can create own deletion requests" on public.account_deletion_requests;
create policy "Users can create own deletion requests"
  on public.account_deletion_requests
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own deletion requests" on public.account_deletion_requests;
create policy "Users can read own deletion requests"
  on public.account_deletion_requests
  for select
  using (auth.uid() = user_id);

comment on table public.account_deletion_requests is
  'Audit records for in-app account deletion requests.';
