alter table public.businesses
add column if not exists sms_settings_reviewed_at timestamptz;
