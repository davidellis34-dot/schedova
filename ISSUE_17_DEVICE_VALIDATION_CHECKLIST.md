# Issue 17 Device Validation Checklist

This checklist separates what was confirmed in code and logic tests from what still requires a real device build.

## Code-Verified

- Google OAuth diagnostics are hidden unless `EXPO_PUBLIC_SCHEDOVA_INTERNAL_AUTH_DEBUG=true`.
- Appointment create and update flows only schedule SMS when SMS is enabled.
- Appointment cancel and delete flows stop calling SMS helpers when SMS is explicitly disabled.
- Lower-level appointment SMS safety guards still skip sends when the saved appointment has SMS disabled.
- Existing logic coverage passes for onboarding skip, returning-user routing, password-reset routing helpers, client consent handling, appointment delivery validation, and SMS mutation gating.

## Real Device Required

Code inspection and logic tests do not prove Android or iOS UI behavior. Run every checklist item on a physical build before treating Issue 17 as closed.

## Android Checklist

1. Fresh install
   Install the newest Expo build, open Schedova, and confirm the app starts on the walkthrough or login flow with no debug diagnostics shown.
2. Sign up and login
   Create a brand-new account, finish sign-in, and confirm you land in the correct first-run flow without getting stuck.
3. Returning-user login
   Clear local app storage, sign in with an existing account that already has business data in Supabase, and confirm you go straight into the app instead of looping back through onboarding.
4. Walkthrough and onboarding
   Swipe through the walkthrough, continue into onboarding, and confirm the normal Continue flow still validates required setup fields.
5. Skip for now
   Leave the business setup form empty, tap `Skip for now`, and confirm you enter the main app immediately.
6. First client
   Add a client with name only, then add another client with phone, email, SMS consent, and Email consent to confirm both lightweight and full records save.
7. First service
   Add a service, confirm it appears in pickers, and confirm the app still works after backing out and reopening the screen.
8. Single-service appointment
   Book one appointment with one service and verify it appears in Calendar, Dashboard, and Appointments List after save.
9. Multi-service appointment
   Book one appointment with multiple services and verify totals, duration, and saved services look correct everywhere.
10. Edit, reschedule, cancel, and delete appointment
    Edit the appointment, move it to a new time, cancel it, then create another appointment and delete it. Confirm the UI updates correctly after each action.
11. Appointment reminder recipient behavior
    Test `Email ON / SMS OFF`, `SMS ON without phone`, `SMS ON without SMS consent`, and `SMS ON with valid phone and consent` and confirm the warning and save behavior match the audit requirements.
12. Force-close and reopen
    Force-close the app from Android app switcher, reopen it, and confirm clients, services, appointments, and onboarding state persist.
13. Background and resume
    Put the app in the background during login, onboarding, and booking, then resume it and confirm no stuck loading state or duplicate action occurs.
14. Keyboard overlap
    Check login, onboarding, add client, add service, and book appointment on a small Android phone to confirm buttons and text fields stay reachable above the keyboard.
15. Small-phone and tablet layout
    Validate the main flows on the connected phone and, if available, an Android tablet or emulator-sized device to confirm no cut-off controls or unusable spacing.

## iOS Checklist

1. Fresh install
   Install the newest iOS build and confirm the app opens cleanly with no internal Google OAuth debug panel.
2. Sign up and login
   Create a new account and sign in with an existing account to confirm both first-run and returning-user routing work.
3. Returning-user login
   Clear local app data if possible for the test build, or reinstall the app, then sign in with an account that already finished setup and confirm you reach the main app.
4. Walkthrough and onboarding
   Complete the walkthrough and confirm normal Continue still validates required business setup fields.
5. Skip for now
   Leave onboarding fields empty, tap `Skip for now`, and confirm you enter the app immediately and stay out of onboarding after relaunch.
6. First client
   Add clients with minimal and full contact details and verify the saved consent state stays correct after reopening the client.
7. First service
   Add a service and confirm it appears throughout the booking flow.
8. Single-service appointment
   Book one single-service appointment and verify it appears everywhere expected.
9. Multi-service appointment
   Book one multi-service appointment and verify the appointment details remain correct after reopening and editing it.
10. Edit, reschedule, cancel, and delete appointment
    Confirm each mutation updates the UI correctly and does not produce an SMS warning when SMS is off.
11. Appointment reminder recipient behavior
    Repeat the same four communication cases from Android and confirm the same outcomes.
12. Force-close and reopen
    Swipe the app away, relaunch it, and confirm data persistence and correct post-login routing.
13. Background and resume
    Background the app during auth and booking flows, resume it, and confirm no broken deep link or frozen state.
14. Keyboard overlap
    Verify login, onboarding, add client, add service, and booking fields remain visible above the iPhone keyboard.
15. Small-phone and tablet layout
    Check at least one smaller iPhone and one larger iPhone or iPad-sized build to confirm spacing, safe areas, and modal layouts remain usable.

## External Dependencies Still Requiring Live Verification

- Telnyx-backed SMS delivery and error handling
- Real email delivery and password reset deep links
- RevenueCat paywall, entitlement refresh, and Free/Pro gating in store-backed builds
- TestFlight behavior
- Play Store behavior
