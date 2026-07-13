drop policy if exists "Users can read own messages" on public.messages;

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
