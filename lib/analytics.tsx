import AsyncStorage from "@react-native-async-storage/async-storage";
import type { JsonType } from "@posthog/core";
import Constants from "expo-constants";
import * as ExpoLinking from "expo-linking";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import {
  AppState,
  Linking,
  Platform,
} from "react-native";
import {
  PostHogProvider,
  usePostHog,
  type PostHog,
} from "posthog-react-native";
import { useAuthSession } from "./authSession";
import {
  getAppointmentMilestoneEvents,
  normalizeBusinessCategory,
  normalizeSafeAnalyticsProperties,
  sanitizeAnalyticsCaptureEvent,
  sanitizeAnalyticsText,
  type SafeAnalyticsPropertyKey,
  type SafeAnalyticsProperties,
} from "./analyticsPrivacy";
import { supabase } from "./supabase";

export const ANALYTICS_EVENTS = [
  "app_session_opened",
  "dashboard_viewed",
  "calendar_viewed",
  "clients_viewed",
  "messages_viewed",
  "onboarding_started",
  "onboarding_step_completed",
  "onboarding_completed",
  "service_create_started",
  "service_created",
  "service_create_failed",
  "client_create_started",
  "client_created",
  "client_create_failed",
  "appointment_create_started",
  "appointment_created",
  "appointment_create_failed",
  "appointment_create_cancelled",
  "booking_client_selected",
  "booking_service_selected",
  "booking_date_selected",
  "booking_time_selected",
  "booking_save_started",
  "booking_save_failed",
  "booking_save_completed",
  "first_service_created",
  "first_client_created",
  "first_appointment_created",
  "second_appointment_created",
  "first_booking_card_viewed",
  "first_booking_card_opened",
  "first_booking_flow_opened",
  "first_booking_handoff_started",
  "first_booking_handoff_completed",
  "first_booking_prompt_viewed",
  "first_booking_save_started",
  "first_booking_save_completed",
  "first_booking_prompt_skipped",
  "first_booking_success_viewed",
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
type AnalyticsEventProperties = SafeAnalyticsProperties;
type AcquisitionState = {
  source: string | null;
  campaign: string | null;
};
type AnalyticsEventPayload = {
  event: AnalyticsEventName;
  properties?: AnalyticsEventProperties;
};

const listeners = new Set<AnalyticsListener>();
const pendingEvents: AnalyticsEventPayload[] = [];

const ANALYTICS_ACQUISITION_STORAGE_KEY = "schedova.analytics.acquisition";
const APP_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const POSTHOG_API_KEY = String(process.env.EXPO_PUBLIC_POSTHOG_API_KEY || "").trim();
const POSTHOG_HOST = String(process.env.EXPO_PUBLIC_POSTHOG_HOST || "").trim();
const ANALYTICS_DISABLED = __DEV__ || !POSTHOG_API_KEY;
const APP_VERSION =
  Constants.expoConfig?.version ||
  Constants.nativeAppVersion ||
  "unknown";

let posthogClient: PostHog | null = null;
let identifiedUserId: string | null = null;
let safeProperties: AnalyticsEventProperties = {
  platform: Platform.OS,
  app_version: APP_VERSION,
  acquisition_source: null,
  acquisition_campaign: null,
  business_category: null,
};

function hasPostHogClient() {
  return !ANALYTICS_DISABLED && !!posthogClient;
}

function setAnalyticsClient(client: PostHog | null) {
  posthogClient = client;

  if (!hasPostHogClient() || pendingEvents.length === 0) return;

  const eventsToFlush = pendingEvents.splice(0, pendingEvents.length);
  for (const pendingEvent of eventsToFlush) {
    captureAnalyticsEvent(pendingEvent.event, pendingEvent.properties);
  }
}

function updateSafeProperties(nextProperties: Partial<AnalyticsEventProperties>) {
  const normalizedProperties = normalizeSafeAnalyticsProperties(nextProperties);
  const clearedProperties = Object.fromEntries(
    Object.entries(nextProperties).filter(([, value]) => value === null),
  ) as Partial<AnalyticsEventProperties>;

  if (!normalizedProperties && Object.keys(clearedProperties).length === 0) {
    return;
  }

  safeProperties = {
    ...safeProperties,
    ...clearedProperties,
    ...normalizedProperties,
  };
}

function getSafeEventProperties(
  eventProperties?: Partial<Record<SafeAnalyticsPropertyKey, unknown>>,
): Record<string, JsonType> {
  const next: Record<string, JsonType> = {};
  const normalizedEventProperties =
    normalizeSafeAnalyticsProperties(eventProperties);

  for (const [key, value] of Object.entries(safeProperties)) {
    if (typeof value === "string" && value.trim()) {
      next[key] = value;
      continue;
    }

    if (typeof value === "boolean") {
      next[key] = value;
    }
  }

  for (const [key, value] of Object.entries(normalizedEventProperties || {})) {
    if (typeof value === "string" && value.trim()) {
      next[key] = value;
      continue;
    }

    if (typeof value === "boolean") {
      next[key] = value;
    }
  }

  return next;
}

function captureAnalyticsEvent(
  event: AnalyticsEventName,
  properties?: Partial<Record<SafeAnalyticsPropertyKey, unknown>>,
) {
  if (!hasPostHogClient()) return;
  void posthogClient?.capture(event, getSafeEventProperties(properties));
}

async function readStoredAcquisitionState(): Promise<AcquisitionState> {
  try {
    const storedValue = await AsyncStorage.getItem(
      ANALYTICS_ACQUISITION_STORAGE_KEY,
    );
    if (!storedValue) {
      return { source: null, campaign: null };
    }

    const parsed = JSON.parse(storedValue) as Partial<AcquisitionState> | null;
    return {
      source: sanitizeAnalyticsText(parsed?.source),
      campaign: sanitizeAnalyticsText(parsed?.campaign),
    };
  } catch {
    return { source: null, campaign: null };
  }
}

async function writeStoredAcquisitionState(nextState: AcquisitionState) {
  try {
    await AsyncStorage.setItem(
      ANALYTICS_ACQUISITION_STORAGE_KEY,
      JSON.stringify(nextState),
    );
  } catch {
    // Ignore storage failures. Analytics should never affect app behavior.
  }
}

function readLinkParam(value: unknown) {
  if (Array.isArray(value)) {
    return sanitizeAnalyticsText(value[0]);
  }

  return sanitizeAnalyticsText(value);
}

async function applyAcquisitionFromUrl(url: string | null | undefined) {
  if (!url) return;

  const { queryParams } = ExpoLinking.parse(url);
  const nextState: AcquisitionState = {
    source:
      readLinkParam(queryParams?.acquisition_source) ||
      readLinkParam(queryParams?.utm_source) ||
      readLinkParam(queryParams?.source),
    campaign:
      readLinkParam(queryParams?.acquisition_campaign) ||
      readLinkParam(queryParams?.utm_campaign) ||
      readLinkParam(queryParams?.campaign),
  };

  if (!nextState.source && !nextState.campaign) return;

  updateSafeProperties({
    acquisition_source: nextState.source,
    acquisition_campaign: nextState.campaign,
  });
  await writeStoredAcquisitionState(nextState);
}

function syncIdentifiedUser(posthog: PostHog, nextUserId: string | null) {
  if (nextUserId) {
    if (identifiedUserId === nextUserId) return;
    posthog.identify(nextUserId);
    identifiedUserId = nextUserId;
    return;
  }

  if (!identifiedUserId) return;
  posthog.reset();
  identifiedUserId = null;
}

function AnalyticsBootstrap() {
  const posthog = usePostHog();
  const { authStatus, isAccountReady, isHydrated, userId } = useAuthSession();
  const hasTrackedInitialSessionRef = useRef(false);
  const lastBackgroundedAtRef = useRef<number | null>(null);

  useEffect(() => {
    setAnalyticsClient(posthog);
    return () => setAnalyticsClient(null);
  }, [posthog]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const storedAcquisition = await readStoredAcquisitionState();
      if (!active) return;

      updateSafeProperties({
        acquisition_source: storedAcquisition.source,
        acquisition_campaign: storedAcquisition.campaign,
      });

      const initialUrl = await Linking.getInitialURL();
      if (!active) return;

      await applyAcquisitionFromUrl(initialUrl);
    })();

    const subscription = Linking.addEventListener("url", ({ url }) => {
      void applyAcquisitionFromUrl(url);
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!isHydrated || !isAccountReady || authStatus !== "authenticated" || !userId) {
      updateSafeProperties({ business_category: null });
      return () => {
        active = false;
      };
    }

    void (async () => {
      try {
        const { data, error } = await supabase
          .from("businesses")
          .select("category")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();

        if (!active) return;

        if (error) {
          updateSafeProperties({ business_category: null });
          return;
        }

        updateSafeProperties({
          business_category: normalizeBusinessCategory(data?.category),
        });
      } catch {
        if (!active) return;
        updateSafeProperties({ business_category: null });
      }
    })();

    return () => {
      active = false;
    };
  }, [authStatus, isAccountReady, isHydrated, userId]);

  useEffect(() => {
    if (!isHydrated) return;

    syncIdentifiedUser(
      posthog,
      authStatus === "authenticated" && isAccountReady ? userId || null : null,
    );
  }, [authStatus, isAccountReady, isHydrated, posthog, userId]);

  useEffect(() => {
    function trackSessionIfNeeded() {
      const now = Date.now();
      const shouldTrack =
        !hasTrackedInitialSessionRef.current ||
        (lastBackgroundedAtRef.current !== null &&
          now - lastBackgroundedAtRef.current >= APP_SESSION_TIMEOUT_MS);

      if (!shouldTrack) return;

      hasTrackedInitialSessionRef.current = true;
      trackAnalyticsEvent("app_session_opened");
    }

    if (AppState.currentState === "active") {
      trackSessionIfNeeded();
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        trackSessionIfNeeded();
        return;
      }

      if (nextState === "background" || nextState === "inactive") {
        lastBackgroundedAtRef.current = Date.now();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return null;
}

export function AnalyticsProvider({ children }: { children: ReactNode }) {
  if (!POSTHOG_API_KEY) {
    return <>{children}</>;
  }

  return (
    <PostHogProvider
      apiKey={POSTHOG_API_KEY}
      autocapture={false}
      options={{
        before_send: sanitizeAnalyticsCaptureEvent,
        captureAppLifecycleEvents: false,
        capturePushNotificationOpened: false,
        capturePushNotificationSubscriptions: false,
        disableGeoip: true,
        disableRemoteFeatureFlags: true,
        disableSurveys: true,
        disabled: ANALYTICS_DISABLED,
        enableSessionReplay: false,
        host: POSTHOG_HOST || undefined,
        personProfiles: "identified_only",
        preloadFeatureFlags: false,
        sendFeatureFlagEvent: false,
        setDefaultPersonProperties: false,
      }}
    >
      <AnalyticsBootstrap />
      {children}
    </PostHogProvider>
  );
}

export function trackAnalyticsEvent(
  event: AnalyticsEventName,
  properties?: Partial<Record<SafeAnalyticsPropertyKey, unknown>>,
) {
  // Do not accept arbitrary metadata here. These events must never contain
  // client, appointment, message, token, or account details.
  const normalizedProperties = normalizeSafeAnalyticsProperties(properties);

  if (__DEV__) {
    console.log("[Analytics]", event, normalizedProperties || {});
  }

  listeners.forEach((listener) => listener(event));

  if (hasPostHogClient()) {
    captureAnalyticsEvent(event, normalizedProperties);
    return;
  }

  if (!ANALYTICS_DISABLED) {
    pendingEvents.push({
      event,
      ...(normalizedProperties ? { properties: normalizedProperties } : {}),
    });
  }
}

export function trackAppointmentCreated(
  existingAppointmentCount: number,
  createdAppointmentCount = 1,
) {
  for (const event of getAppointmentMilestoneEvents(
    existingAppointmentCount,
    createdAppointmentCount,
  )) {
    trackAnalyticsEvent(event);
  }
}

export function useTrackAnalyticsScreen(event: AnalyticsEventName) {
  useFocusEffect(
    useCallback(() => {
      trackAnalyticsEvent(event);
    }, [event]),
  );
}

export function subscribeToAnalytics(
  listener: AnalyticsListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
