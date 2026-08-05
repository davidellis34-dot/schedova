# Issue #17 Audit Report

Audit run: August 5, 2026
Repository: `davidellis34-dot/schedova`
Issue: [#17 Full-app blocker audit before scaling acquisition](https://github.com/davidellis34-dot/schedova/issues/17)

## Executive Summary

No confirmed `P0` defects were found in the audited code paths before fixes began, but there are multiple confirmed `P1` issues that can break trust or push a user back into setup at the wrong time:

1. Returning users can be routed back into onboarding because onboarding completion is stored only on-device.
2. Password recovery can send a returning user to onboarding because it checks onboarding without a user id.
3. New clients can be treated as email-message recipients without explicit email consent.
4. Editing a client can leave the saved primary communication recipient stale, so future appointment reminders can validate or send against old contact details.

The earlier SMS appointment-validation issue and the business-setup `Skip for now` path were already addressed in code before this report. The live Android phone check on August 5, 2026 confirmed the first-run entry path is reachable, but the current Expo/bare build still exposes debug-heavy login surfaces that need follow-up verification after the highest-impact fixes land.

## Top 10 Blockers

1. `P1` Returning users depend on local onboarding state instead of server-backed business existence.
2. `P1` Password reset completion can route a finished user into onboarding.
3. `P1` Add Client auto-enables email recipient eligibility from the mere presence of an email address.
4. `P1` Edit Client can preserve stale primary recipient phone/email/consent data.
5. `P2` The Android login experience in the current build exposes internal Google OAuth diagnostics.
6. `P2` Appointment cancellation/update screens still invoke SMS send helpers at some call sites even when SMS is disabled, relying on lower-level guards instead of clean gating.
7. `P2` Physical-device login and first-run onboarding still need a clean post-fix pass on both Android and iOS because the current Android dev-style build is noisy.
8. `P2` Messaging failure handling still needs live provider validation for Telnyx and production email delivery paths.
9. `P2` Free/Pro restrictions still need production store validation on Android and iOS purchase flows.
10. `P3` Onboarding copy contains mojibake in a few visible strings, which hurts trust during first impression.

## Funnel Map

1. Install / open app
   - Failure points: noisy first-run entry surface, debug affordances in current Android build.
2. Sign up / sign in
   - Failure points: password recovery route bug; returning-user routing depends on local onboarding state.
3. Country / walkthrough / onboarding
   - Failure points: returning users can be re-routed into walkthrough/onboarding after reinstall or device change; `Skip for now` required a separate path and has now been separated in code.
4. Create business, service, client
   - Failure points: client contact consent and recipient data can be stored incorrectly.
5. Book first appointment
   - Failure points: appointment delivery validation must only validate enabled channels; stale recipients must not trigger warnings.
6. Edit / reschedule / cancel / delete appointment
   - Failure points: notification helpers still need consistent gating at all call sites.
7. Restart app / return later
   - Failure points: local-only onboarding state can regress returning users on reinstall or device change.

## Findings By Severity

### P0

No confirmed `P0` issues were identified in the audited code paths before fixes began.

### P1

#### P1-1 Returning users can be pushed back into walkthrough/onboarding after reinstall or on a new device

- Severity: `P1`
- File(s): `lib/onboarding.ts`, `lib/walkthrough.ts`, `lib/authRouting.ts`
- Function/component: `getOnboardingState()`, `hasCompletedOnboarding()`, `getWalkthroughState()`, `resolveAuthenticatedAppRoute()`
- Repro steps:
  1. Use an account that already has business data in Supabase.
  2. Open Schedova on a fresh install or new device where local AsyncStorage onboarding keys do not exist.
  3. Sign in.
- Expected:
  - A returning business owner with existing backend data should go straight into the app.
- Actual:
  - Routing trusts local AsyncStorage state only, so a returning user can be treated like a first-time user and sent to walkthrough or onboarding.
- Root cause:
  - Completion state is stored locally in AsyncStorage and there is no server-backed fallback in authenticated route resolution.
- Recommended fix:
  - Add a backend-aware fallback so existing businesses count as completed onboarding for routing, while still preserving local onboarding progress for true first-run users.
- Test coverage to add:
  - Returning user with local onboarding state missing but existing business profile routes to dashboard.
  - Brand-new user with no business profile still routes through walkthrough/onboarding.

#### P1-2 Password recovery can route a completed user into onboarding

- Severity: `P1`
- File(s): `app/reset-password.tsx`
- Function/component: `finishPasswordRecovery()`
- Repro steps:
  1. Complete onboarding with an existing user.
  2. Start password recovery and open the reset link inside the app.
  3. Save the new password.
- Expected:
  - User should return to the same authenticated route resolution used after a normal sign-in.
- Actual:
  - The screen checks `hasCompletedOnboarding()` without a user id, so the lookup falls back to `false` and can route a returning user into onboarding.
- Root cause:
  - The password recovery flow bypasses the shared authenticated-route resolver and omits the current `userId`.
- Recommended fix:
  - Route password recovery through shared authenticated-route resolution using the current signed-in user id.
- Test coverage to add:
  - Password recovery for a completed user routes to dashboard.
  - Password recovery for an incomplete user still routes to walkthrough/onboarding as appropriate.

#### P1-3 Add Client stores email-eligible communication recipients without explicit email consent

- Severity: `P1`
- File(s): `app/add-client.tsx`
- Function/component: primary-recipient sync `useEffect`, `saveClientCommunicationRecipients()` payload mapping
- Repro steps:
  1. Add a new client with an email address.
  2. Do not explicitly opt the client into email appointment messages.
  3. Save the client and later load appointment communication recipients.
- Expected:
  - The client should only be eligible for email if email consent was explicitly granted.
- Actual:
  - The primary recipient is marked `emailEnabled` when any non-empty email address exists.
- Root cause:
  - Add Client uses `primary.emailEnabled || Boolean(email.trim())` and the same pattern again during recipient persistence.
- Recommended fix:
  - Stop inferring email consent from the presence of an email address. Persist email eligibility only from explicit consent state.
- Test coverage to add:
  - New client with email but no email consent does not persist an email-enabled primary recipient.

#### P1-4 Edit Client can leave the saved primary recipient stale after profile edits

- Severity: `P1`
- File(s): `components/clients/EditClientForm.tsx`
- Function/component: recipient loading/saving path in `saveClient()`
- Repro steps:
  1. Open an existing client with a saved primary recipient.
  2. Edit the top-level phone, email, name, or consent toggles.
  3. Save the client and later create or edit an appointment for that client.
- Expected:
  - The primary communication recipient should stay in sync with the edited client record.
- Actual:
  - The save path prefers stale recipient values such as `recipient.phone || trimmedPhone` and `recipient.email || trimmedEmail`, so older data can survive edits.
- Root cause:
  - Unlike Add Client, Edit Client does not keep the primary recipient synchronized with top-level form fields before persistence.
- Recommended fix:
  - Introduce a shared primary-recipient sync helper and use it in both create and edit flows before saving.
- Test coverage to add:
  - Editing the primary phone/email updates the saved primary recipient.
  - Consent changes update the saved primary recipient without requiring extra manual edits.

### P2

#### P2-1 Internal Google OAuth debug panel is visible on the current Android build

- Severity: `P2`
- File(s): `app/login.tsx`, `lib/debugMode.ts`
- Function/component: `authDebugVisible`
- Repro steps:
  1. Open the current Android build on-device.
  2. Reach the login surface.
- Expected:
  - Production-facing users should see a clean sign-in screen.
- Actual:
  - The login surface shows `Google OAuth Debug`, platform, redirect, environment, and build-profile diagnostics.
- Root cause:
  - Debug visibility is tied to internal/debug build conditions that are active in the current phone build.
- Recommended fix:
  - Hide internal auth diagnostics from any acquisition-facing build and keep them behind explicit internal flags only.
- Test coverage to add:
  - Logic test for debug visibility conditions.

#### P2-2 Some appointment mutation screens still call SMS helpers even when SMS is disabled

- Severity: `P2`
- File(s): `app/book-appointment.tsx`, `app/appointments-list.tsx`, `app/calendar-view.tsx`, `app/dashboard.tsx`, `lib/appointmentSms.ts`
- Function/component: cancellation/update/delete notification paths
- Repro steps:
  1. Cancel or delete appointments with SMS notifications disabled.
  2. Trace notification side effects.
- Expected:
  - SMS helper functions should not be invoked when SMS is disabled.
- Actual:
  - Some call sites still invoke the SMS helper and rely on lower-level guardrails to no-op.
- Root cause:
  - Call-site gating is inconsistent across appointment mutation flows.
- Recommended fix:
  - Keep the lower-level guard, but also gate call sites using appointment delivery settings for cleaner behavior and clearer telemetry.
- Test coverage to add:
  - Cancellation/update/delete paths do not call SMS scheduling/sending logic when SMS is disabled.

#### P2-3 Physical-device first-run and cross-platform reliability still need live validation

- Severity: `P2`
- File(s): live-device behavior, not a single code file
- Function/component: install-to-first-booking flow, push through login/walkthrough/onboarding
- Repro steps:
  1. Run the full first-run funnel on real Android and iPhone hardware.
  2. Complete onboarding, skip onboarding, restart the app, and create the first appointment.
- Expected:
  - The same clean flow should work on both platforms.
- Actual:
  - Android testing on August 5, 2026 confirmed reachable first-run surfaces but the current Expo/bare build remained noisy, so a clean post-fix device pass is still required.
- Root cause:
  - Current testing build includes internal/debug noise and was not yet re-validated end-to-end after all issue-17 fixes.
- Recommended fix:
  - Re-run the full device matrix after P1 fixes land.
- Test coverage to add:
  - Manual device checklist only.

### P3

#### P3-1 Onboarding copy includes mojibake in visible strings

- Severity: `P3`
- File(s): `app/onboarding.tsx`
- Function/component: button/loading copy
- Repro steps:
  1. Open onboarding.
  2. Inspect loading and skip-related copy.
- Expected:
  - Text should render with normal punctuation.
- Actual:
  - Some strings render as `Savingâ€¦`, `Iâ€™ll`, and similar artifacts.
- Root cause:
  - Text encoding artifacts in source strings.
- Recommended fix:
  - Normalize affected strings to plain UTF-8 punctuation or ASCII equivalents.
- Test coverage to add:
  - None required beyond visual verification.

## Supabase Data Isolation And Security

Live read/write spot checks against the Supabase project on August 5, 2026 did not find a confirmed cross-account isolation failure in the tested tables:

- `businesses`
- `services`
- `clients`
- `appointments`
- `blocked_times`
- `availability_rules`
- `messages`
- `client_contacts`
- `appointment_message_recipients`
- `sms_settings`
- `sms_message_logs`
- `user_subscriptions`

Result: the second account could not read or no-op update rows owned by the first account in the tested paths.

Residual risk:

- RLS still needs a migration-level sweep for completeness.
- Edge functions and service-role paths still need targeted review where they operate outside normal anon-client constraints.

## Proposed Fix Order

1. Preserve returning-user routing by adding server-aware onboarding fallback.
2. Route password recovery through the shared authenticated-route resolver.
3. Fix client contact consent and recipient synchronization in Add Client and Edit Client.
4. Keep the earlier appointment-delivery validation fix covered with regression tests.
5. Re-run device tests for login, onboarding skip, first booking, restart, and appointment edits.
6. Then tackle P2 cleanup items such as auth debug visibility and remaining notification call-site gating.

## Unverified Areas Requiring More Than Local Logic Tests

- Android full first-run funnel after all issue-17 fixes land
- iOS full first-run funnel after all issue-17 fixes land
- Telnyx delivery failures, retries, and provider-side status reconciliation
- Production email delivery failures and bounce/invalid-recipient handling
- RevenueCat / App Store / Play Store free-to-pro purchase and restore flows
- App reinstall and device-switch behavior on physical hardware using an already-configured account
