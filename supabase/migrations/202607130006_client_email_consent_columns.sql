alter table public.clients
  add column if not exists email_opt_in boolean not null default false,
  add column if not exists email_opt_in_at timestamptz,
  add column if not exists email_opt_in_source text,
  add column if not exists email_opt_out_at timestamptz;

alter table public.client_contacts
  add column if not exists sms_consent_source text,
  add column if not exists email_consent_source text;

create index if not exists clients_user_email_consent_idx
  on public.clients (user_id, email_opt_in, email_opt_in_at);

comment on column public.clients.email_opt_in is
  'Whether the client has agreed to receive appointment email messages.';

comment on column public.clients.email_opt_in_at is
  'Timestamp when email messaging consent was recorded.';

comment on column public.clients.email_opt_in_source is
  'Source used when email messaging consent was recorded.';

notify pgrst, 'reload schema';
