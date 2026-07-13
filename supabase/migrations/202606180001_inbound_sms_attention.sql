alter table public.sms_message_logs
  add column if not exists to_number text,
  add column if not exists message_body text,
  add column if not exists provider text,
  add column if not exists direction text,
  add column if not exists from_number text,
  add column if not exists provider_response jsonb,
  add column if not exists needs_attention boolean not null default false,
  add column if not exists attention_reason text,
  add column if not exists read_at timestamptz,
  add column if not exists resolved_at timestamptz;

alter table public.appointments
  add column if not exists sms_confirmation_sent_at timestamptz,
  add column if not exists sms_reminder_sent_at timestamptz,
  add column if not exists needs_attention boolean not null default false,
  add column if not exists attention_reason text;

comment on column public.sms_message_logs.needs_attention is
  'True when an inbound or outbound SMS log should be reviewed by the business owner.';

comment on column public.sms_message_logs.attention_reason is
  'Short explanation for why the SMS log needs follow-up.';

comment on column public.sms_message_logs.read_at is
  'When the business owner opened or acknowledged the message in the app.';

comment on column public.sms_message_logs.resolved_at is
  'When the business owner finished handling the inbound message.';

comment on column public.appointments.needs_attention is
  'True when an appointment needs manual follow-up from the business owner.';

comment on column public.appointments.attention_reason is
  'Why the appointment was marked for attention.';

create index if not exists sms_message_logs_user_id_needs_attention_created_at_idx
  on public.sms_message_logs (user_id, needs_attention, created_at desc);

create index if not exists sms_message_logs_user_id_direction_created_at_idx
  on public.sms_message_logs (user_id, direction, created_at desc);

create index if not exists appointments_user_id_needs_attention_idx
  on public.appointments (user_id, needs_attention);

drop policy if exists "Users can update own sms logs" on public.sms_message_logs;
create policy "Users can update own sms logs"
  on public.sms_message_logs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
