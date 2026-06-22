# Telnyx SMS Launch Setup

This app now supports Telnyx-backed appointment SMS behind a paid-subscription gate.

## What is included

- `supabase/migrations/202605210001_sms_paywall.sql`
  - `user_subscriptions` table
  - `sms_settings` table
  - client SMS consent fields
  - `sms_message_logs` table
  - RLS policies
- `supabase/functions/send-appointment-sms/index.ts`
  - backend-only Telnyx sender
  - verifies the signed-in user
  - verifies `user_subscriptions.status = 'active'`
  - checks SMS settings
  - checks client phone + `sms_opt_in`
  - logs each Telnyx send attempt, provider message IDs, provider responses, and failures
- `app/settings/sms.tsx`
  - paid-plan SMS settings UI
- client opt-in switches in Add/Edit Client

## Required Supabase setup

Apply the SMS/backend migrations before using the patched app:

```bash
supabase db push
```

Minimum migration set for the current SMS/backend slice:

- `supabase/migrations/202605210001_sms_paywall.sql`
- `supabase/migrations/202605280003_user_settings_country_region.sql`
- `supabase/migrations/202605310001_revenuecat_subscription_sync.sql`
- `supabase/migrations/202606020001_message_templates.sql`
- `supabase/migrations/202606020002_allow_revenuecat_entitlements.sql`
- `supabase/migrations/202606020003_allow_revenuecat_entitlement_source.sql`

If you are also shipping in-app account deletion with this backend batch, include:

- `supabase/migrations/202605280002_account_deletion_requests.sql`
- `supabase/functions/delete-account/index.ts`

Or paste the SQL into the Supabase SQL editor in migration order.

Deploy the Edge Function:

```bash
supabase functions deploy send-appointment-sms
```

Set Telnyx secrets in Supabase:

```bash
supabase secrets set TELNYX_API_KEY=KEYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TELNYX_MESSAGING_PROFILE_ID=40019eb3-5bb9-433c-af8c-ed6e7e38cd3c
supabase secrets set TELNYX_FROM_NUMBER=+13367929581
```

Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in the Edge Function environment. Supabase normally provides these automatically for deployed functions. Do not expose the Telnyx API key in the mobile app. SMS must be sent from Supabase Edge Functions or other backend-only services.

This Telnyx flow expects the live database to include:

- `public.sms_message_logs.provider`
- `public.sms_message_logs.provider_message_id`
- `public.sms_message_logs.provider_response`
- `public.sms_message_logs.error_message`
- `public.clients.sms_opt_in`
- `public.clients.sms_opt_in_at`
- `public.clients.sms_opt_out_at`
- `public.clients.sms_opt_in_source`
- `public.appointments.sms_reminder_sent_at`
- `public.appointments.sms_confirmation_sent_at`

## Marking a subscriber paid

Until Stripe/revenue billing is wired in, mark a paid test user manually:

```sql
insert into public.user_subscriptions (user_id, status, plan)
values ('USER_UUID_HERE', 'active', 'paid')
on conflict (user_id)
do update set status = 'active', plan = 'paid', updated_at = now();
```

Free users cannot send SMS from the frontend or by directly calling the function. The Edge Function returns HTTP 402 for non-paid accounts.

## Client consent

SMS sends only when all of these are true:

- business/user has `user_subscriptions.status = 'active'`
- SMS Settings are enabled
- the message type is enabled
- the appointment belongs to the user
- the client belongs to the user
- the client has a phone number
- `clients.sms_opt_in = true`

## Safe deployment checklist

Use this checklist for a non-destructive rollout. Do not point the app at production until each item below is verified in staging or your linked preview project.

1. Commit the SMS/backend files together.
   - `supabase/functions/send-appointment-sms/index.ts`
   - `supabase/migrations/202605210001_sms_paywall.sql`
   - `supabase/migrations/202605280003_user_settings_country_region.sql`
   - `supabase/migrations/202605310001_revenuecat_subscription_sync.sql`
   - `supabase/migrations/202606020001_message_templates.sql`
   - `supabase/migrations/202606020002_allow_revenuecat_entitlements.sql`
   - `supabase/migrations/202606020003_allow_revenuecat_entitlement_source.sql`
   - `lib/messageTemplates.ts`

2. Apply migrations first.
   - Run `supabase db push` against the intended non-production project.
   - Verify `user_subscriptions`, `sms_settings`, `sms_message_logs`, and `message_templates` exist.
   - Verify `clients.sms_opt_in`, `clients.sms_opt_in_at`, and `clients.sms_opt_in_source` exist.
   - Verify `user_settings.country_region` exists.

3. Deploy the Edge Function only after the schema is in place.
   - Run `supabase functions deploy send-appointment-sms`
   - Confirm the function is listed in Supabase and uses the expected project.

4. Set Telnyx secrets before testing.
   - `TELNYX_API_KEY`
   - `TELNYX_MESSAGING_PROFILE_ID`
   - `TELNYX_FROM_NUMBER`

5. Seed one paid test user.
   - Add or upsert one `public.user_subscriptions` row for the tester.
   - Use `status = 'active'`.
   - Use a plan/entitlement the function accepts, such as `plan = 'paid'` or `entitlement = 'schedova_pro'`.

6. Enable SMS for that tester.
   - Create or update the tester's `public.sms_settings` row.
   - Set `enabled = true`.
   - Set `appointment_confirmations_enabled = true`.
   - Set `appointment_updates_enabled = true`.
   - Set `appointment_cancellations_enabled = true`.
   - Enable reminder settings only if you are manually testing reminder sends.

7. Prepare opt-in test data.
   - Use one client owned by the tester.
   - Set a valid mobile number.
   - Set `sms_opt_in = true`.
   - Optionally stamp `sms_opt_in_at` and `sms_opt_in_source`.

8. Create one appointment owned by that tester and linked to the opted-in client.
   - Confirmation, update, and cancellation SMS all use the appointment ID.

9. Smoke test after deploy.
   - Create an appointment and verify confirmation SMS.
   - Edit the appointment and verify update SMS.
   - Cancel or delete the appointment and verify cancellation SMS.
   - Check `sms_message_logs` for queued/sent/failed rows after each action.
   - Confirm successful confirmation sends stamp `appointments.sms_confirmation_sent_at`.
   - Confirm successful reminder sends stamp `appointments.sms_reminder_sent_at`.

## Current scope

Appointment create/update/cancel/delete can invoke the SMS function. Automatic future reminder SMS still needs a scheduled cron/Edge Function if you want server-side reminders. Local device reminders are already separate and do not notify clients.

## After Telnyx verification

Confirmation, update, and cancellation SMS can be tested immediately once the checklist above is complete. Automatic timed reminder SMS is not fully wired yet because there is no backend scheduler invoking the reminder path on a schedule.
