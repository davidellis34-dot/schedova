create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

create table if not exists private.app_secrets (
  key text primary key,
  value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table private.app_secrets is
  'Server-only configuration values read by scheduled database jobs.';

alter table private.app_secrets enable row level security;

revoke all on table private.app_secrets from public;
revoke all on table private.app_secrets from anon;
revoke all on table private.app_secrets from authenticated;

do $$
begin
  perform cron.unschedule('schedova-send-due-appointment-reminders');
exception when others then
  null;
end $$;

select cron.schedule(
  'schedova-send-due-appointment-reminders',
  '*/5 * * * *',
  $$
  select
    net.http_post(
      url := 'https://tzbnnmjogxidyltanufu.supabase.co/functions/v1/send-due-appointment-reminders',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-schedova-cron-secret', coalesce(
          (
            select value
            from private.app_secrets
            where key = 'reminder_cron_secret'
          ),
          ''
        )
      ),
      body := jsonb_build_object(
        'source', 'pg_cron',
        'requested_at', now()
      ),
      timeout_milliseconds := 30000
    );
  $$
);
