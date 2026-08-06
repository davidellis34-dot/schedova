import Constants from "expo-constants";
import { Redirect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, Text, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  ScreenHeader,
} from "../../components/ui";
import { useAuthSession } from "../../lib/authSession";
import { copyTextToClipboard } from "../../lib/clipboard";
import { isSchedovaQaToolsEnabled } from "../../lib/debugMode";
import { ENABLE_PRO } from "../../lib/proFeatureFlag";
import { getOnboardingState, resetOnboardingState } from "../../lib/onboarding";
import { resetContextTips } from "../../lib/contextTips";
import { getRevenueCatDebugSnapshot } from "../../lib/revenuecat/revenueCatService";
import { useSubscription } from "../../lib/revenuecat/SubscriptionProvider";
import { SMART_REMINDERS_ENABLED, getDueRebookingClients } from "../../lib/smartReminders";
import {
  showSmsCreditsPrompt,
  showAddClientPhonePrompt,
  showSmsSetupPrompt,
  showTemporarySmsFailurePrompt,
} from "../../lib/guidedWorkflows";
import { useAppTheme } from "../../lib/useAppTheme";
import {
  getWalkthroughState,
  markWalkthroughComplete,
  resetWalkthroughState,
} from "../../lib/walkthrough";
import { WALKTHROUGH_SCREEN_COUNT } from "../../lib/walkthroughFlow";

export default function QaToolsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { userId } = useAuthSession();
  const { customerInfo, isPro, refresh } = useSubscription();
  const [busy, setBusy] = useState(false);
  const [anonymousUserId, setAnonymousUserId] = useState<string | null>(null);
  const [reminderCount, setReminderCount] = useState<number | null>(null);
  const [walkthroughStatus, setWalkthroughStatus] = useState("Unavailable");
  const [onboardingStatus, setOnboardingStatus] = useState("Unavailable");

  const refreshIntroductionState = useCallback(async () => {
    if (!userId) {
      setWalkthroughStatus("No signed-in account");
      setOnboardingStatus("No signed-in account");
      return;
    }

    const [walkthrough, onboarding] = await Promise.all([
      getWalkthroughState(userId),
      getOnboardingState(userId),
    ]);
    setWalkthroughStatus(
      walkthrough.completed
        ? "Complete"
        : `In progress: screen ${walkthrough.step + 1} of ${WALKTHROUGH_SCREEN_COUNT}`,
    );
    setOnboardingStatus(
      onboarding.completed
        ? "Complete"
        : onboarding.started
          ? `In progress: step ${onboarding.draft.step + 1} of 6`
          : "Not started",
    );
  }, [userId]);

  useEffect(() => {
    let active = true;
    void getRevenueCatDebugSnapshot(customerInfo, userId)
      .then((snapshot) => {
        if (active) {
          setAnonymousUserId(snapshot.isAnonymous ? snapshot.appUserID : null);
        }
      })
      .catch(() => {
        // Diagnostics stay optional and must never block the QA screen.
      });
    return () => {
      active = false;
    };
  }, [customerInfo, userId]);

  useEffect(() => {
    void refreshIntroductionState().catch(() => {
      setWalkthroughStatus("Unavailable");
      setOnboardingStatus("Unavailable");
    });
  }, [refreshIntroductionState]);

  if (!isSchedovaQaToolsEnabled()) {
    return <Redirect href="/settings" />;
  }

  async function resetOnboarding() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await resetOnboardingState(userId);
      await refreshIntroductionState();
      Alert.alert("Onboarding reset", "The next onboarding visit starts from the beginning. Business data was not deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function resetWalkthrough() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await resetWalkthroughState(userId);
      await refreshIntroductionState();
      Alert.alert("Walkthrough reset", "The introduction will start from the beginning. Business data was not deleted.");
    } finally {
      setBusy(false);
    }
  }

  async function completeWalkthrough() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await markWalkthroughComplete(userId);
      await refreshIntroductionState();
      Alert.alert("Walkthrough complete", "The current account will no longer be routed through the introduction.");
    } finally {
      setBusy(false);
    }
  }

  async function resetTips() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      await resetContextTips(userId);
      Alert.alert("Contextual tips reset", "One-time tips can appear again for this account.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshRevenueCat() {
    if (busy) return;
    setBusy(true);
    try {
      await refresh();
      const snapshot = await getRevenueCatDebugSnapshot(customerInfo, userId);
      setAnonymousUserId(snapshot.isAnonymous ? snapshot.appUserID : null);
      Alert.alert("RevenueCat refreshed", "Customer information was refreshed for the current account.");
    } catch {
      Alert.alert("RevenueCat unavailable", "Customer information could not be refreshed right now.");
    } finally {
      setBusy(false);
    }
  }

  async function refreshReminders() {
    if (!userId || busy) return;
    setBusy(true);
    try {
      const due = await getDueRebookingClients(userId);
      setReminderCount(due.length);
    } catch {
      Alert.alert("Smart Reminders unavailable", "Due reminders could not be refreshed right now.");
    } finally {
      setBusy(false);
    }
  }

  async function copyDiagnostics() {
    const safeText = [
      "Schedova QA diagnostics",
      `Version: ${Constants.expoConfig?.version || Constants.nativeAppVersion || "Unavailable"}`,
      `Build: ${Constants.nativeBuildVersion || "Unavailable"}`,
      `Pro access: ${isPro ? "active" : "inactive"}`,
      `Pro feature flag: ${ENABLE_PRO ? "enabled" : "disabled"}`,
      `Smart Reminders flag: ${SMART_REMINDERS_ENABLED ? "enabled" : "disabled"}`,
    ].join("\n");
    await copyTextToClipboard(safeText);
    Alert.alert("Diagnostics copied", "Only safe app configuration details were copied.");
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} horizontalPadding={20} bottomPadding={32}>
      <ScreenHeader showBack title="QA Tools" subtitle="Development-only launch checks. Never included in production." />
      <View style={{ gap: 14 }}>
        <AppCard style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Safe diagnostics</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
            Version {Constants.expoConfig?.version || Constants.nativeAppVersion || "Unavailable"} · Build {Constants.nativeBuildVersion || "Unavailable"}
          </Text>
          <Text style={{ color: colors.mutedText }}>Current anonymous RevenueCat ID: {anonymousUserId || "Not anonymous"}</Text>
          <Text style={{ color: colors.mutedText }}>Pro: {isPro ? "Active" : "Free"} · Smart Reminders: {SMART_REMINDERS_ENABLED ? "Enabled" : "Disabled"}</Text>
          <AppButton title="Copy safe diagnostics" variant="secondary" onPress={() => void copyDiagnostics()} />
        </AppCard>

        <AppCard style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Refresh and reset</Text>
          <AppButton title="Refresh RevenueCat customer info" loading={busy} disabled={busy} onPress={() => void refreshRevenueCat()} />
          <AppButton title="Reset onboarding progress" variant="secondary" loading={busy} disabled={busy || !userId} onPress={() => void resetOnboarding()} />
          <AppButton title={reminderCount === null ? "Refresh Smart Reminders" : `${reminderCount} reminder${reminderCount === 1 ? "" : "s"} due`} variant="secondary" loading={busy} disabled={busy || !userId} onPress={() => void refreshReminders()} />
          <AppButton title="Open feedback" variant="ghost" onPress={() => router.push("/settings/feedback" as never)} />
        </AppCard>

        <AppCard style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Walkthrough and onboarding</Text>
          <Text style={{ color: colors.mutedText }}>Walkthrough: {walkthroughStatus}</Text>
          <Text style={{ color: colors.mutedText }}>Onboarding: {onboardingStatus}</Text>
          <AppButton title="Open walkthrough preview" variant="secondary" disabled={busy || !userId} onPress={() => router.push({ pathname: "/walkthrough", params: { from: "qa" } } as never)} />
          <AppButton title="Mark walkthrough complete" variant="secondary" loading={busy} disabled={busy || !userId} onPress={() => void completeWalkthrough()} />
          <AppButton title="Reset walkthrough" variant="secondary" loading={busy} disabled={busy || !userId} onPress={() => void resetWalkthrough()} />
          <AppButton title="Reset contextual tips" variant="secondary" loading={busy} disabled={busy || !userId} onPress={() => void resetTips()} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {Array.from({ length: WALKTHROUGH_SCREEN_COUNT }).map((_, index) => (
              <AppButton
                key={index}
                title={`Screen ${index + 1}`}
                variant="ghost"
                fullWidth={false}
                disabled={busy || !userId}
                onPress={() =>
                  router.push({
                    pathname: "/walkthrough",
                    params: { from: "qa", screen: String(index + 1) },
                  } as never)
                }
                style={{ minHeight: 44 }}
                textStyle={{ fontSize: 12 }}
              />
            ))}
          </View>
        </AppCard>

        <AppCard style={{ gap: 10 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Guided workflow previews</Text>
          <AppButton title="SMS setup prompt" variant="secondary" onPress={() => showSmsSetupPrompt((route) => router.push(route as never))} />
          <AppButton title="Missing client phone prompt" variant="secondary" onPress={() => showAddClientPhonePrompt(() => Alert.alert("Edit Client", "The sample Edit Client action was selected."))} />
          <AppButton title="No credits prompt" variant="secondary" onPress={() => showSmsCreditsPrompt((route) => router.push(route as never))} />
          <AppButton title="Temporary failure prompt" variant="secondary" onPress={() => showTemporarySmsFailurePrompt(() => Alert.alert("Retry selected", "The sample retry action was selected."))} />
        </AppCard>
      </View>
    </AppScreen>
  );
}
