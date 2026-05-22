# Twilio SMS Launch Setup

This app now supports Twilio appointment SMS behind a paid-subscription gate.

## What is included

- `supabase/migrations/202605210001_sms_paywall.sql`
  - `user_subscriptions` table
  - `sms_settings` table
  - client SMS opt-in fields
  - `sms_message_logs` table
  - RLS policies
- `supabase/functions/send-appointment-sms/index.ts`
  - backend-only Twilio sender
  - verifies the signed-in user
  - verifies `user_subscriptions.status = 'active'`
  - checks SMS settings
  - checks client phone + `sms_opt_in`
  - logs sent/failed SMS messages
- `app/settings/sms.tsx`
  - paid-plan SMS settings UI
- client opt-in switches in Add/Edit Client

## Required Supabase setup

Run the migration before using the patched app:

```bash
supabase db push
```

Or paste the SQL in `supabase/migrations/202605210001_sms_paywall.sql` into the Supabase SQL editor.

Deploy the Edge Function:

```bash
supabase functions deploy send-appointment-sms
```

Set Twilio secrets in Supabase:

```bash
supabase secrets set TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
supabase secrets set TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` exist in the Edge Function environment. Supabase normally provides these automatically for deployed functions.

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

## Current scope

Appointment create/update/cancel/delete can invoke the SMS function. Automatic future reminder SMS still needs a scheduled cron/Edge Function if you want server-side reminders. Local device reminders are already separate and do not notify clients.
