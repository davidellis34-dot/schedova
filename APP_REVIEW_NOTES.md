# App Review Notes

Use this file as a checklist when filling out Apple App Review and Google Play test instructions.

## Test Accounts

- Create one Free reviewer account in Supabase Auth and provide its email/password only in App Store Connect / Play Console reviewer notes.
- Optional: create one Pro reviewer account by manually adding a row in `public.user_subscriptions`; Pro is a locked preview/manual entitlement in this build, not an in-app paid subscription.
- Do not promise paid subscription purchase, restore, or manage-subscription flows for this version.

## Reviewer Path

- Settings includes Contact Support, Privacy Policy, Terms of Use, and Delete Account.
- Delete Account starts from inside the app. Deploy `delete-account` before review for automatic deletion; otherwise the app records an in-app deletion request and shows `support@schedova.com` as fallback help.
- SMS automation requires the Supabase SMS migration, `send-appointment-sms` Edge Function, Telnyx secrets, a Pro-entitled test user, SMS Settings enabled, a client phone number, and client SMS opt-in.

## Store Notes

- Explain that Pro features are preview/locked unless a manual test entitlement is provided.
- Explain that SMS is optional for review and only sends after explicit client opt-in.
- Include the live Privacy Policy URL and Account Deletion URL from `https://schedova.com`.
