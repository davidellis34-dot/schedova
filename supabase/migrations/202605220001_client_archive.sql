alter table public.clients
  add column if not exists archived_at timestamptz;

create index if not exists clients_active_user_id_name_idx
  on public.clients (user_id, name)
  where archived_at is null;

comment on column public.clients.archived_at is
  'Soft-delete timestamp for clients removed from the active client list.';
