# Schedova Email Setup

Schedova appointment and manual client emails are sent through the backend email provider. Client-facing email should use:

- From: `[Business Name] via Schedova <support@schedova.com>`
- Reply-To: the signed-in business owner's email address

The business owner's personal email must not be used as the sender address. In version one it is only used as the Reply-To address, so client replies go to the owner's normal inbox.

## Provider

The current Edge Functions use Resend.

Required Supabase Function secrets:

- `RESEND_API_KEY`
- `EMAIL_PROVIDER_API_URL` only if overriding the default Resend API URL

Do not set `EMAIL_FROM_ADDRESS` to a business owner email. The backend formats the sender as `Business Name via Schedova <support@schedova.com>`.

## Domain Verification

Verify `schedova.com` in Resend before production email sending.

In Resend, add and verify the DNS records it gives you for:

- SPF / sending authorization
- DKIM signing
- Return-path / bounce handling if Resend provides one

Use the exact DNS host names and values shown in Resend. After DNS propagates, Resend should show the domain as verified.

## Version One Reply Routing

Resend Free allows one custom domain. For version one, verify only `schedova.com` and do not require `reply.schedova.com`.

Appointment and manual email replies go to the signed-in business owner's normal email inbox through the Reply-To header.

Outgoing emails are still stored in Schedova Messages and labeled as outbound email. The app should not wait for inbound email routing or show errors about inbound replies.

Keep `support@schedova.com` available as the public support address and visible sender address.

## Future Reply Routing

When Schedova has paying users and the email provider plan supports another domain/subdomain, enable `reply.schedova.com` and route inbound replies into Messages through:

- `https://tzbnnmjogxidyltanufu.supabase.co/functions/v1/inbound-email-reply`

The existing `inbound-email-reply` code and `email_reply_tokens` schema are kept for that future upgrade.
