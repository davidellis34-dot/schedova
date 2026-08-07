create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.inbound_sms_manual_reviews (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'telnyx',
  provider_message_id text,
  event_type text,
  from_number text not null,
  to_number text not null,
  message_body text,
  normalized_reply_text text,
  routing_status text not null default 'pending',
  routing_reason text not null,
  resolved_user_id uuid references auth.users(id) on delete set null,
  candidate_user_ids uuid[],
  candidate_context jsonb not null default '[]'::jsonb,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution_notes text,
  constraint inbound_sms_manual_reviews_status_check
    check (routing_status in ('pending', 'resolved', 'dismissed'))
);

comment on table private.inbound_sms_manual_reviews is
  'Unresolved inbound SMS replies that could not be safely routed to a single Schedova business.';

create unique index if not exists inbound_sms_manual_reviews_provider_message_idx
  on private.inbound_sms_manual_reviews (provider, provider_message_id)
  where provider_message_id is not null;

alter table private.inbound_sms_manual_reviews enable row level security;

revoke all on table private.inbound_sms_manual_reviews from public;
revoke all on table private.inbound_sms_manual_reviews from anon;
revoke all on table private.inbound_sms_manual_reviews from authenticated;
