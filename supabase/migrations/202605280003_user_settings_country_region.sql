create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  country_region text not null default 'US',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_settings_country_region_check
    check (country_region in ('US', 'CA', 'GB', 'AU'))
);

comment on column public.user_settings.country_region is
  'Default country/region used for local phone number normalization.';

alter table public.user_settings enable row level security;

drop policy if exists "Users can read own settings" on public.user_settings;
create policy "Users can read own settings"
  on public.user_settings
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create own settings" on public.user_settings;
create policy "Users can create own settings"
  on public.user_settings
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own settings" on public.user_settings;
create policy "Users can update own settings"
  on public.user_settings
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
