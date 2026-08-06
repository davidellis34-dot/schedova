import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { Platform } from "react-native";

import { SUPPORT_EMAIL } from "./legalLinks";
import { supabase } from "./supabase";

export const FEEDBACK_TYPES = [
  "Feature request",
  "Something is confusing",
  "Report a problem",
  "Something I like",
  "Other",
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export type FeedbackMetadata = {
  appVersion: string | null;
  buildNumber: string | null;
  platform: string;
  osVersion: string | number | null;
  deviceModel: string | null;
  sourceScreen: string | null;
};

function normalizeText(value: string | null | undefined) {
  return String(value || "").trim();
}

export function getFeedbackMetadata(input: {
  includeDeviceInfo: boolean;
  sourceScreen?: string | null;
}): FeedbackMetadata | null {
  if (!input.includeDeviceInfo) return null;

  const deviceName = (Constants as typeof Constants & { deviceName?: string })
    .deviceName;

  return {
    appVersion: Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? null,
    buildNumber: Constants.nativeBuildVersion ?? null,
    platform: Platform.OS,
    osVersion: Platform.Version ?? null,
    deviceModel: normalizeText(deviceName) || null,
    sourceScreen: normalizeText(input.sourceScreen) || null,
  };
}

export function buildFeedbackEmailUrl(input: {
  feedbackType: FeedbackType;
  title: string;
  description: string;
  metadata: FeedbackMetadata | null;
}) {
  const lines = [
    `Feedback type: ${input.feedbackType}`,
    "",
    input.description.trim(),
  ];

  if (input.metadata) {
    lines.push(
      "",
      "App information:",
      `App version: ${input.metadata.appVersion || "Unavailable"}`,
      `Build: ${input.metadata.buildNumber || "Unavailable"}`,
      `Platform: ${input.metadata.platform}`,
      `OS version: ${input.metadata.osVersion || "Unavailable"}`,
      `Device: ${input.metadata.deviceModel || "Unavailable"}`,
      `Source screen: ${input.metadata.sourceScreen || "Unavailable"}`,
    );
  }

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(`Schedova feedback: ${input.title.trim()}`)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

export async function submitFeedback(input: {
  feedbackType: FeedbackType;
  title: string;
  description: string;
  metadata: FeedbackMetadata | null;
  submissionKey: string;
}) {
  const { data, error } = await supabase.functions.invoke("submit-feedback", {
    body: input,
  });

  if (error) throw error;
  if (!data || typeof data !== "object" || !("ok" in data) || !data.ok) {
    throw new Error("Feedback could not be sent right now.");
  }
}

export async function openFeedbackEmailFallback(input: {
  feedbackType: FeedbackType;
  title: string;
  description: string;
  metadata: FeedbackMetadata | null;
}) {
  const url = buildFeedbackEmailUrl(input);
  const supported = await Linking.canOpenURL(url);

  if (!supported) {
    throw new Error("No email app is available. Contact support@schedova.com.");
  }

  await Linking.openURL(url);
}
