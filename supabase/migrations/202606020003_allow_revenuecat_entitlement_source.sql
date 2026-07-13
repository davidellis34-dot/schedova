alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_entitlement_source_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_entitlement_source_check
  check (
    entitlement_source is null
    or entitlement_source in (
      'manual',
      'revenuecat',
      'stripe',
      'admin',
      'test'
    )
  )
  not valid;

comment on constraint user_subscriptions_entitlement_source_check
  on public.user_subscriptions is
  'Allows manual launch entitlements and RevenueCat subscription mirror rows.';
