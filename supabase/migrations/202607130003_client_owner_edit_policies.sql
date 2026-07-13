alter table public.clients enable row level security;

drop policy if exists "Users can read own clients" on public.clients;
create policy "Users can read own clients"
  on public.clients
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can update own clients" on public.clients;
create policy "Users can update own clients"
  on public.clients
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can insert own clients" on public.clients;
create policy "Users can insert own clients"
  on public.clients
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own clients" on public.clients;
create policy "Users can delete own clients"
  on public.clients
  for delete
  using (auth.uid() = user_id);
