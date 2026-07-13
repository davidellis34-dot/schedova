alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_entitlement_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_entitlement_check
  check (
    entitlement is null
    or entitlement in (
      'pro',
      'schedova_pro',
      'monthly',
      'yearly',
      'lifetime',
      'paid',
      'free',
      'Schedova Pro'
    )
  )
  not valid;

comment on constraint user_subscriptions_entitlement_check
  on public.user_subscriptions is
  'Allows manual launch Pro entitlement and RevenueCat schedova_pro subscription mirror values.';
