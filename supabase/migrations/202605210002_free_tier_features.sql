alter table public.clients
  add column if not exists notes text;

alter table public.clients
  add column if not exists client_tag text default 'New';

update public.clients
set client_tag = 'New'
where client_tag is null
  or client_tag not in ('New', 'Regular', 'VIP');

alter table public.clients
  alter column client_tag set default 'New',
  alter column client_tag set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'clients_client_tag_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_client_tag_check
      check (client_tag in ('New', 'Regular', 'VIP'));
  end if;
end $$;

alter table public.appointments
  add column if not exists service_snapshots jsonb default '[]'::jsonb;

update public.appointments
set service_snapshots = '[]'::jsonb
where service_snapshots is null;

alter table public.appointments
  alter column service_snapshots set default '[]'::jsonb,
  alter column service_snapshots set not null;

comment on column public.clients.client_tag is
  'Free-tier preset client tag: New, Regular, or VIP.';

comment on column public.appointments.service_snapshots is
  'Snapshot of selected service names, durations, and prices at booking time.';
