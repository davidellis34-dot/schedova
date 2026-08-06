import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  EmptyState,
  LoadingCard,
  ScreenHeader,
  SuccessToast,
} from "../components/ui";
import { trackAnalyticsEvent } from "../lib/analytics";
import { sendManualClientSms } from "../lib/appointmentSms";
import { useAuthSession } from "../lib/authSession";
import { canUseFeature } from "../lib/featureAccess";
import {
  isSmsConfigurationError,
  isSmsCreditError,
  isTemporarySmsError,
  showSmsCreditsPrompt,
  showSmsSetupPrompt,
  showTemporarySmsFailurePrompt,
} from "../lib/guidedWorkflows";
import { showProUpgradePrompt } from "../lib/proUpsell";
import {
  completeSmartReminderSend,
  createSmartReminderAction,
  getDueRebookingClients,
  releaseSmartReminderSend,
  SMART_REMINDERS_ENABLED,
  type DueRebookingClient,
} from "../lib/smartReminders";
import { notifySmartRemindersChanged } from "../lib/smartReminderEvents";
import { getSmartReminderSnoozeDate } from "../lib/smartReminderState";
import { useAppTheme } from "../lib/useAppTheme";

function formatCalendarDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
}

function buildReminderMessage(reminder: DueRebookingClient) {
  return `Hi ${reminder.clientName}, it looks like you may be ready for another ${reminder.serviceName}. Reply here or book your next appointment when you are ready.`;
}

export default function SmartRemindersScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { isAccountReady, userId } = useAuthSession();
  const [reminders, setReminders] = useState<DueRebookingClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [activeReminder, setActiveReminder] = useState<DueRebookingClient | null>(null);
  const [messageBody, setMessageBody] = useState("");
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const latestUserIdRef = useRef<string | null>(userId);
  latestUserIdRef.current = userId;

  const loadReminders = useCallback(async () => {
    if (!isAccountReady || !userId) {
      setReminders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const next = await getDueRebookingClients(userId);
      if (latestUserIdRef.current !== userId) return;
      setReminders(next);
      trackAnalyticsEvent("smart_reminder_reviewed");
    } catch {
      if (latestUserIdRef.current !== userId) return;
      setErrorMessage("Unable to load clients ready to rebook. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [isAccountReady, userId]);

  useFocusEffect(
    useCallback(() => {
      void loadReminders();
    }, [loadReminders]),
  );

  const removeReminder = useCallback((reminder: DueRebookingClient) => {
    setReminders((current) =>
      current.filter(
        (item) =>
          !(
            item.clientId === reminder.clientId &&
            item.serviceId === reminder.serviceId &&
            item.dueOn === reminder.dueOn
          ),
      ),
    );
  }, []);

  function reminderKey(reminder: DueRebookingClient) {
    return `${reminder.clientId}:${reminder.serviceId}:${reminder.dueOn}`;
  }

  async function saveNonSendAction(
    reminder: DueRebookingClient,
    action: "dismissed" | "remind_later",
  ) {
    if (!userId || sendingKey) return;

    const key = reminderKey(reminder);
    setSendingKey(key);
    try {
      const saved = await createSmartReminderAction({
        userId,
        reminder,
        action,
        remindAfter:
          action === "remind_later" ? getSmartReminderSnoozeDate() : null,
      });
      if (!saved) {
        Alert.alert("Already updated", "This reminder was already handled.");
      }
      removeReminder(reminder);
      notifySmartRemindersChanged();
    } catch {
      Alert.alert("Could not update reminder", "Please try again.");
    } finally {
      setSendingKey(null);
    }
  }

  function openComposer(reminder: DueRebookingClient) {
    setActiveReminder(reminder);
    setMessageBody(buildReminderMessage(reminder));
  }

  async function sendReminder() {
    if (!activeReminder || !userId || !messageBody.trim() || sendingKey) return;

    const key = reminderKey(activeReminder);
    setSendingKey(key);
    try {
      const claimed = await createSmartReminderAction({
        userId,
        reminder: activeReminder,
        action: "sending",
      });
      if (!claimed) {
        setActiveReminder(null);
        removeReminder(activeReminder);
        notifySmartRemindersChanged();
        Alert.alert("Already updated", "This reminder was already handled.");
        return;
      }

      const result = await sendManualClientSms({
        clientId: activeReminder.clientId,
        appointmentId: activeReminder.appointmentId,
        messageBody: messageBody.trim(),
      });

      if (!result.ok || result.skipped) {
        await releaseSmartReminderSend({ userId, reminder: activeReminder });
        const code = result.code || null;
        if (isSmsConfigurationError(code)) {
          showSmsSetupPrompt((route) => router.push(route as never));
        } else if (isSmsCreditError(code)) {
          showSmsCreditsPrompt((route) => router.push(route as never));
        } else if (isTemporarySmsError(code)) {
          showTemporarySmsFailurePrompt(() => {
            void sendReminder();
          });
        } else {
          Alert.alert(
            "Reminder not sent",
            result.message || "The reminder text could not be sent.",
          );
        }
        return;
      }

      await completeSmartReminderSend({ userId, reminder: activeReminder });
      trackAnalyticsEvent("smart_reminder_sent");
      removeReminder(activeReminder);
      setActiveReminder(null);
      notifySmartRemindersChanged();
      setSuccessMessage("Reminder sent.");
    } catch {
      try {
        await releaseSmartReminderSend({ userId, reminder: activeReminder });
      } catch {
        // The original failure is the actionable error. A future refresh keeps
        // the record hidden if the one-time send claim could not be released.
      }
      Alert.alert("Reminder not sent", "Please try again.");
    } finally {
      setSendingKey(null);
    }
  }

  if (!SMART_REMINDERS_ENABLED) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <ScreenHeader showBack title="Smart Reminders" />
        <EmptyState
          title="Smart Reminders is not enabled"
          message="This preview stays off until the team enables it for QA."
        />
      </AppScreen>
    );
  }

  if (!canUseFeature("smartReminders")) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <ScreenHeader showBack title="Smart Reminders" />
        <AppCard style={{ gap: 14 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
            Smart Reminders is a Pro feature
          </Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>
            Review due clients and send each reminder only when you are ready.
          </Text>
          <AppButton
            title="View Schedova Pro"
            onPress={() =>
              showProUpgradePrompt(
                "Smart Rebooking Reminders are included with Schedova Pro.",
              )
            }
          />
        </AppCard>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={20}
      bottomPadding={32}
    >
      <ScreenHeader
        showBack
        title="Smart Reminders"
        subtitle="Review every reminder before sending. Automatic sending is off."
      />

      {successMessage ? (
        <SuccessToast
          message={successMessage}
          onDismiss={() => setSuccessMessage("")}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {loading ? (
        <LoadingCard label="Finding clients ready to rebook..." lines={3} />
      ) : errorMessage ? (
        <AppCard style={{ gap: 12 }}>
          <Text style={{ color: "#B91C1C", fontWeight: "900" }}>{errorMessage}</Text>
          <AppButton title="Retry" variant="secondary" onPress={() => void loadReminders()} />
        </AppCard>
      ) : reminders.length === 0 ? (
        <EmptyState
          title="No reminders due"
          message="Clients will appear here when their service rebooking interval is due."
        />
      ) : (
        <View style={{ gap: 12 }}>
          {reminders.map((reminder) => {
            const key = reminderKey(reminder);
            const saving = sendingKey === key;
            return (
              <AppCard key={key} style={{ gap: 12 }}>
                <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                  <View
                    style={{
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: `${colors.primary}1A`,
                    }}
                  >
                    <Ionicons name="calendar-outline" size={21} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
                      {reminder.clientName}
                    </Text>
                    <Text style={{ color: colors.mutedText, marginTop: 3 }}>
                      Last completed: {reminder.serviceName} on {formatCalendarDate(reminder.lastCompletedOn)}
                    </Text>
                    <Text style={{ color: colors.primary, fontWeight: "800", marginTop: 6 }}>
                      Due {formatCalendarDate(reminder.dueOn)}
                    </Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <AppButton
                    title="Edit & Send"
                    fullWidth={false}
                    style={{ flex: 1 }}
                    onPress={() => openComposer(reminder)}
                    disabled={Boolean(sendingKey)}
                  />
                  <AppButton
                    title="Later"
                    variant="secondary"
                    fullWidth={false}
                    style={{ flex: 1 }}
                    onPress={() => void saveNonSendAction(reminder, "remind_later")}
                    loading={saving}
                    disabled={Boolean(sendingKey)}
                  />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Dismiss reminder for ${reminder.clientName}`}
                    onPress={() => void saveNonSendAction(reminder, "dismissed")}
                    disabled={Boolean(sendingKey)}
                    style={({ pressed }) => ({
                      width: 48,
                      minHeight: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: colors.border,
                      borderRadius: 12,
                      opacity: pressed || saving ? 0.55 : 1,
                    })}
                  >
                    <Ionicons name="close" size={22} color={colors.mutedText} />
                  </Pressable>
                </View>
              </AppCard>
            );
          })}
        </View>
      )}

      <Modal
        visible={Boolean(activeReminder)}
        transparent
        animationType="fade"
        onRequestClose={() => !sendingKey && setActiveReminder(null)}
      >
        <Pressable
          onPress={() => !sendingKey && setActiveReminder(null)}
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.52)" }}
        >
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              gap: 14,
            }}
          >
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
              Review reminder
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              Edit this text before it is sent. Schedova never sends reminders automatically.
            </Text>
            <AppTextInput
              label="Message"
              value={messageBody}
              onChangeText={setMessageBody}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
              editable={!Boolean(sendingKey)}
            />
            <AppButton
              title="Send Reminder"
              loading={Boolean(sendingKey)}
              disabled={!messageBody.trim() || Boolean(sendingKey)}
              onPress={() => void sendReminder()}
            />
            <AppButton
              title="Cancel"
              variant="ghost"
              disabled={Boolean(sendingKey)}
              onPress={() => setActiveReminder(null)}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </AppScreen>
  );
}
