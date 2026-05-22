# Launch Patch Notes

This patch prepares the Expo/Supabase booking app for launch-critical testing and adds paid-only Twilio SMS infrastructure.

## App fixes

- Calendar preferences now have a shared helper for 15/30/60 minute intervals, 12/24-hour time format, and start/end display hours.
- Booking/edit appointment time pickers now use the saved calendar interval instead of hardcoded 30-minute slots.
- Calendar view uses saved interval/time format and respects saved calendar display start/end hours as fallback.
- Appointment create/update schedules local owner reminders and attempts non-blocking SMS sends.
- Appointment cancellation/delete attempts non-blocking cancellation SMS, then cancels local reminders.
- Dashboard and appointments list status/delete writes are scoped by `user_id`.
- Bulk delete in appointments list now uses the platform-safe destructive confirmation helper.
- Add/edit client supports phone-only/email-only/name-only clients and SMS opt-in fields.
- Blocked-time save paths validate end time after start time and check appointment/block overlaps.
- Service delete now uses the platform-safe destructive confirmation helper.
- Static `expo-notifications` imports were removed from shared notification entrypoints so Android Expo Go does not load notifications accidentally.

## Twilio SMS launch setup

- Added `sms_settings` UI at `/settings/sms`.
- Added `user_subscriptions` paywall table, `sms_settings`, client SMS consent fields, and `sms_message_logs` migration.
- Added Supabase Edge Function `send-appointment-sms`.
- Twilio credentials stay server-side only in Supabase Edge Function secrets.
- SMS sends are blocked server-side unless `user_subscriptions.status = 'active'`.
- SMS requires business SMS enabled and client `sms_opt_in = true`.

## Required before testing SMS

Run the migration and deploy the Edge Function before using the SMS-enabled client fields:

```bash
supabase db push
supabase functions deploy send-appointment-sms
supabase secrets set TWILIO_ACCOUNT_SID=xxx TWILIO_AUTH_TOKEN=xxx TWILIO_MESSAGING_SERVICE_SID=xxx
```

Then mark a test user active in `user_subscriptions` from the Supabase SQL editor or your Stripe webhook.

## Local validation in this environment

A targeted TypeScript syntax/type pass was run against the patched files with local shims because the container could not complete dependency installation for the full Expo project. Run these locally after installing dependencies:

```bash
npm install
npx tsc --noEmit
npm run lint
npx expo run:android
```
