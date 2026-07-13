drop policy if exists "Users can create own revenuecat subscription sync" on public.user_subscriptions;
create policy "Users can create own revenuecat subscription sync"
  on public.user_subscriptions
  for insert
  with check (
    auth.uid() = user_id
    and entitlement_source = 'revenuecat'
  );

drop policy if exists "Users can update own revenuecat subscription sync" on public.user_subscriptions;
create policy "Users can update own revenuecat subscription sync"
  on public.user_subscriptions
  for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and entitlement_source = 'revenuecat'
  );

comment on table public.user_subscriptions is
  'Subscription entitlement mirror. RevenueCat is the purchase source of truth; this table is used for backend visibility and SMS gating.';
