alter table public.clients
  alter column phone drop not null;

comment on column public.clients.phone is
  'Optional client phone number. Clients can be saved with name, phone, email, or any combination.';
