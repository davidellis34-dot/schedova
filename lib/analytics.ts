// This intentionally has no provider yet. It gives every workflow one safe,
// private event vocabulary without allowing ad-hoc client or message payloads.
export const ANALYTICS_EVENTS = [
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "first_service_created",
  "first_client_created",
  "first_appointment_created",
  "sms_setup_prompt_viewed",
  "feedback_screen_viewed",
  "feedback_submitted",
  "smart_reminder_reviewed",
  "smart_reminder_sent",
  "pro_screen_viewed",
  "subscription_purchase_started",
  "subscription_purchase_completed",
  "subscription_purchase_failed",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

type AnalyticsListener = (event: AnalyticsEventName) => void;

const listeners = new Set<AnalyticsListener>();

export function trackAnalyticsEvent(event: AnalyticsEventName) {
  // Do not accept arbitrary metadata here. These events must never contain
  // client, appointment, message, token, or account details.
  if (__DEV__) {
    console.log("[Analytics]", event);
  }

  listeners.forEach((listener) => listener(event));
}

export function subscribeToAnalytics(
  listener: AnalyticsListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
