# Schedova Auth Setup

This app now supports:

- email/password sign in and sign up
- password reset with an in-app recovery screen
- Google sign-in through Supabase OAuth
- native Apple sign-in on iOS through `expo-apple-authentication` plus `signInWithIdToken`
- authenticated password changes for email/password accounts

## Current app redirect scheme

The Expo app config already uses:

- Scheme: `schedova`
- iOS bundle ID: `com.davidellis34.schedova`
- Android package: `com.davidellis34.schedova`

The mobile auth flow uses these in-app redirect paths:

- Login/social callback: `schedova://login`
- Password reset callback: `schedova://reset-password`

In Supabase Auth URL configuration, allow either:

- `schedova://**`

or at minimum both explicit URLs above.

For this app, keep all three allow-listed in Supabase URL Configuration:

- `schedova://login`
- `schedova://reset-password`
- `schedova://**`

## Supabase configuration

1. In the Supabase dashboard, open Auth > URL Configuration.
2. Keep the app redirect URLs allow-listed.
3. For TestFlight and production, do not leave the Supabase Site URL set to `localhost`. Use a real HTTPS site URL you control. If Supabase rejects the requested mobile deep link redirect, it can fall back to the Site URL.
4. In Auth > Providers, enable Google and Apple.

## Password reset

The login screen sends reset emails with the redirect:

- `schedova://reset-password`

When the user opens that email link on their device, Schedova completes the recovery session and shows the Reset Password screen.

## Google OAuth configuration

This implementation uses Supabase-hosted browser OAuth, not the native Google SDK.

1. In Google Cloud, create an OAuth client of type `Web application`.
2. In the Google provider settings inside Supabase, copy the authorized redirect URI shown by Supabase and add that exact URI to the Google OAuth client.
3. The Google Cloud redirect URI must stay pointed at the Supabase callback URL for this project:
   - `https://tzbnnmjogxidyltanufu.supabase.co/auth/v1/callback`
4. On native iOS/Android standalone, dev-client, and TestFlight builds, the app's `redirectTo` value sent to Supabase should be the app deep link route:
   - `schedova://login`
   - Do not use localhost for native mobile redirects.
5. On local web development, localhost-based redirects are acceptable when developing locally.
6. If the browser still lands on `localhost` after Google approval, check Supabase Auth > URL Configuration again. That means Supabase is still falling back to a localhost Site URL or a rejected redirect target.
7. Save the Google Client ID and Client Secret in Supabase Auth > Providers > Google.
8. If Google asks for authorized origins, use the values required by your Supabase project configuration.
9. If multiple Google client IDs are configured in Supabase, keep the web client ID first.

## Apple Sign-In configuration

This implementation now uses native Apple sign-in on iOS with `expo-apple-authentication`, then exchanges the returned Apple identity token with Supabase using `signInWithIdToken`.

Required Apple setup:

1. Keep Sign in with Apple enabled on the iOS App ID / bundle ID `com.davidellis34.schedova` in Apple Developer.
2. In Expo config, keep `ios.usesAppleSignIn` enabled and include the `expo-apple-authentication` plugin.
3. In Supabase, keep the Apple provider enabled so Supabase can accept Apple identity tokens through `signInWithIdToken`.
4. This native iOS Apple flow does not use `expo-auth-session`, `WebBrowser`, or Supabase-hosted Apple OAuth redirects.
5. A Services ID is not required for the native iOS flow. Add a Services ID later only if Apple sign-in is introduced on web, Android, or via Supabase-hosted OAuth again.
6. Apple only returns full name and email on the first approved sign-in. Capture and save that information when it is available.

## Expo / native notes

- `expo-auth-session` and `expo-crypto` are required for the browser-based mobile OAuth flow.
- `expo-apple-authentication` is required for native Apple sign-in on iOS.
- The app scheme is already present in `app.json`, so the redirect can return to Schedova in native builds.
- If you change the scheme later, update both `app.json` and the Supabase redirect allow-list.

## Account management

- Email/password users can change their password from Settings > Change Password.
- Social-only users do not get the change-password action because their password is managed by the identity provider.
- Existing session persistence remains enabled through the current Supabase storage configuration.

## Recommended verification pass

Test these flows on both iOS and Android:

1. Email/password sign in
2. Forgot password email send
3. Opening the reset link back into the app
4. Resetting the password successfully
5. Google sign-in success and cancel
6. Apple sign-in success and cancel on iOS
7. App restart with session persistence
8. Settings > Change Password for an email/password account
