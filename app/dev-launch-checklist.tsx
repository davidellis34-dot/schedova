import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import type { AppointmentSmsMessageType } from "../lib/appointmentSms";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const STORAGE_KEY = "schedova_launch_readiness_checklist_v2";

const CHECKLIST_SECTIONS = [
  {
    title: "Core app",
    items: [
      "Sign up/login works",
      "Add client works",
      "Add service works",
      "Book appointment works",
      "Multi-service booking works",
      "Edit appointment works",
      "Delete appointment works",
      "iOS date picker works",
      "Tap outside closes picker boxes",
      "Settings support email works",
      "Account deletion path works",
    ],
  },
  {
    title: "Pro / RevenueCat",
    items: [
      "Android dev build RevenueCat works",
      "iOS dev build RevenueCat tested",
      "`schedova_pro` entitlement works",
      "Paywall opens",
      "Paywall close returns cleanly",
      "Cancel does not unlock Pro",
      "Purchase unlocks Pro",
      "Restore purchases works",
      "Customer Center opens",
      "Active Pro users are not prompted to buy again",
      "Cancel/refund help exists",
    ],
  },
  {
    title: "Stores",
    items: [
      "Privacy policy live",
      "Terms of Service live",
      "Apple subscriptions ready to submit",
      "Apple subscriptions attached to next app version",
      "Google closed testing complete",
      "Google production access requested",
      "Google production access approved",
      "App Store review passed",
      "Production builds use main Expo account only",
    ],
  },
  {
    title: "Backend",
    items: [
      "Supabase migration deployed",
      "SMS Edge Function deployed",
      "Telnyx secrets set",
      "SMS opt-in respected",
      "Account deletion confirmed",
      "Support email confirmed",
    ],
  },
  {
    title: "Final release",
    items: [
      "Run `eas whoami` before build",
      "Main Expo account confirmed for store builds",
      "Android AAB built",
      "iOS store build uploaded",
      "Final smoke test passed",
      "Tester feedback reviewed",
      "Launch decision made",
    ],
  },
] as const;

type ChecklistState = Record<string, boolean>;
type LatestAppointment = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
};

function itemId(sectionTitle: string, item: string) {
  return `${sectionTitle}:${item}`;
}

function getAllItemIds() {
  return CHECKLIST_SECTIONS.flatMap((section) =>
    section.items.map((item) => itemId(section.title, item)),
  );
}

function getSectionProgress(
  section: (typeof CHECKLIST_SECTIONS)[number],
  checkedItems: ChecklistState,
) {
  const completed = section.items.filter(
    (item) => checkedItems[itemId(section.title, item)],
  ).length;

  return {
    completed,
    total: section.items.length,
  };
}

export default function DevLaunchChecklistScreen() {
  const { colors } = useAppTheme();
  const [checkedItems, setCheckedItems] = useState<ChecklistState>({});
  const [loaded, setLoaded] = useState(false);
  const [smsAppointmentId, setSmsAppointmentId] = useState("");
  const [latestAppointment, setLatestAppointment] =
    useState<LatestAppointment | null>(null);
  const [latestAppointmentLoading, setLatestAppointmentLoading] =
    useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsResult, setSmsResult] = useState("");

  useEffect(() => {
    if (!__DEV__) {
      router.replace("/settings" as any);
      return;
    }

    void loadChecklist();
  }, []);

  const allItemIds = useMemo(getAllItemIds, []);
  const completedCount = allItemIds.filter((id) => checkedItems[id]).length;
  const totalCount = allItemIds.length;
  const overallPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  async function loadChecklist() {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);

    if (!saved) {
      setLoaded(true);
      return;
    }

    try {
      const parsed = JSON.parse(saved) as ChecklistState;
      setCheckedItems(parsed || {});
    } catch {
      setCheckedItems({});
    } finally {
      setLoaded(true);
    }
  }

  async function saveChecklist(nextState: ChecklistState) {
    setCheckedItems(nextState);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  }

  function toggleItem(id: string) {
    const nextState = {
      ...checkedItems,
      [id]: !checkedItems[id],
    };

    void saveChecklist(nextState);
  }

  function markSectionComplete(section: (typeof CHECKLIST_SECTIONS)[number]) {
    const nextState = { ...checkedItems };

    section.items.forEach((item) => {
      nextState[itemId(section.title, item)] = true;
    });

    void saveChecklist(nextState);
  }

  function confirmReset() {
    Alert.alert(
      "Reset Launch Checklist?",
      "This clears all checked launch readiness items on this device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Reset",
          style: "destructive",
          onPress: () => {
            void saveChecklist({});
          },
        },
      ],
    );
  }

  async function loadLatestAppointment() {
    setLatestAppointmentLoading(true);

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        Alert.alert("SMS test", "Please sign in again before testing SMS.");
        return;
      }

      const { data, error } = await supabase
        .from("appointments")
        .select("id, client_id, client_name, appointment_date, appointment_time")
        .eq("user_id", user.id)
        .order("appointment_date", { ascending: false })
        .order("appointment_time", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        Alert.alert("SMS test", error.message);
        return;
      }

      if (!data) {
        setLatestAppointment(null);
        Alert.alert(
          "SMS test",
          "No appointments were found for the signed-in account.",
        );
        return;
      }

      const appointment = data as LatestAppointment;
      setLatestAppointment(appointment);
      setSmsAppointmentId(appointment.id);
    } finally {
      setLatestAppointmentLoading(false);
    }
  }

  async function sendTestSms(messageType: AppointmentSmsMessageType) {
    const appointmentId = smsAppointmentId.trim();
    const clientId =
      latestAppointment?.id === appointmentId
        ? String(latestAppointment.client_id || "").trim() || null
        : null;

    if (!appointmentId) {
      Alert.alert("SMS test", "Enter or load an appointment ID first.");
      return;
    }

    setSmsSending(true);
    setSmsResult("");

    try {
      const payload = {
        appointment_id: appointmentId,
        client_id: clientId,
        message_type: messageType,
      };
      console.log("SMS button tapped");
      Alert.alert("SMS test", "SMS button tapped");
      console.log("SMS payload", payload);
      const { data, error } = await supabase.functions.invoke(
        "send-appointment-sms",
        {
          body: payload,
        },
      );
      console.log("SMS function data", data);
      console.log("SMS function error", error);
      const nextResult = JSON.stringify(
        {
          messageType,
          appointmentId,
          clientId,
          payload,
          data,
          error: error
            ? {
                name: error.name,
                message: error.message,
                status: (error as { context?: Response }).context?.status,
              }
            : null,
        },
        null,
        2,
      );

      setSmsResult(nextResult);

      if (error) {
        Alert.alert("SMS test", `Function error: ${error.message}`);
        return;
      }

      Alert.alert("SMS test", "Function success");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown SMS test error.";
      console.log("SMS exception", error);
      setSmsResult(
        JSON.stringify(
          {
            messageType,
            appointmentId,
            clientId,
            ok: false,
            code: "exception",
            message,
          },
          null,
          2,
        ),
      );
      Alert.alert("SMS test", `Caught exception: ${message}`);
    } finally {
      setSmsSending(false);
    }
  }

  if (!__DEV__ || !loaded) return null;

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={56}>
      <Pressable
        onPress={() => router.back()}
        style={{ alignSelf: "flex-start", marginBottom: 16 }}
      >
        <Text style={{ color: colors.primary, fontWeight: "900" }}>Back</Text>
      </Pressable>

      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        Launch Checklist
      </Text>

      <Text
        style={{
          color: colors.mutedText,
          fontSize: 15,
          lineHeight: 22,
          marginBottom: 16,
        }}
      >
        Internal readiness tracker for development builds only.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 16,
          marginBottom: 18,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
          {completedCount}/{totalCount} complete
        </Text>
        <Text style={{ color: colors.mutedText, marginTop: 6 }}>
          {overallPercent}% ready. Saved locally on this device.
        </Text>
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: 999,
            height: 9,
            marginTop: 14,
            overflow: "hidden",
          }}
        >
          <View
            style={{
              backgroundColor: colors.primary,
              height: 9,
              width: `${overallPercent}%`,
            }}
          />
        </View>
      </View>

      {CHECKLIST_SECTIONS.map((section) => {
        const sectionProgress = getSectionProgress(section, checkedItems);
        const sectionComplete =
          sectionProgress.completed === sectionProgress.total;

        return (
          <View
            key={section.title}
            style={{
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 14,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 12,
                marginBottom: 10,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 19,
                    fontWeight: "900",
                  }}
                >
                  {section.title}
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 13,
                    fontWeight: "800",
                    marginTop: 4,
                  }}
                >
                  {sectionProgress.completed}/{sectionProgress.total} complete
                </Text>
              </View>

              <Pressable
                disabled={sectionComplete}
                onPress={() => markSectionComplete(section)}
                style={{
                  backgroundColor: sectionComplete
                    ? colors.background
                    : colors.primary,
                  borderColor: sectionComplete ? colors.border : colors.primary,
                  borderWidth: 1,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 7,
                  opacity: sectionComplete ? 0.65 : 1,
                }}
              >
                <Text
                  style={{
                    color: sectionComplete ? colors.mutedText : "#FFFFFF",
                    fontSize: 12,
                    fontWeight: "900",
                  }}
                >
                  {sectionComplete ? "Complete" : "Mark complete"}
                </Text>
              </Pressable>
            </View>

            {section.items.map((item) => {
              const id = itemId(section.title, item);
              const checked = Boolean(checkedItems[id]);

              return (
                <Pressable
                  key={id}
                  onPress={() => toggleItem(id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                  }}
                >
                  <View
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      borderWidth: 1,
                      borderColor: checked ? colors.primary : colors.border,
                      backgroundColor: checked
                        ? colors.primary
                        : colors.background,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: checked ? "#FFFFFF" : colors.mutedText,
                        fontWeight: "900",
                      }}
                    >
                      {checked ? "\u2713" : ""}
                    </Text>
                  </View>

                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontWeight: "700",
                      flex: 1,
                      lineHeight: 20,
                    }}
                  >
                    {item}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <View
        style={{
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 14,
          padding: 16,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 19,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          SMS Test Tools
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: 14,
            lineHeight: 20,
            marginBottom: 12,
          }}
        >
          Development-only helper for the deployed
          `send-appointment-sms` Edge Function. Requires Telnyx secrets, an
          active subscription row, SMS settings enabled, and a client with a
          phone number plus SMS opt-in.
        </Text>

        <Text
          style={{
            color: colors.text,
            fontSize: 13,
            fontWeight: "800",
            marginBottom: 6,
          }}
        >
          Appointment ID
        </Text>

        <TextInput
          value={smsAppointmentId}
          onChangeText={setSmsAppointmentId}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="Paste appointment UUID"
          placeholderTextColor={colors.mutedText}
          style={{
            color: colors.text,
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 12,
            marginBottom: 12,
          }}
        />

        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: latestAppointment ? 10 : 12,
          }}
        >
          <Pressable
            disabled={latestAppointmentLoading || smsSending}
            onPress={() => {
              void loadLatestAppointment();
            }}
            style={{
              flex: 1,
              backgroundColor: colors.primary,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              opacity: latestAppointmentLoading || smsSending ? 0.65 : 1,
            }}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
              {latestAppointmentLoading
                ? "Loading..."
                : "Load Latest Appointment"}
            </Text>
          </Pressable>

          <Pressable
            disabled={smsSending}
            onPress={() => {
              setLatestAppointment(null);
              setSmsAppointmentId("");
              setSmsResult("");
            }}
            style={{
              flex: 1,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              paddingVertical: 12,
              alignItems: "center",
              opacity: smsSending ? 0.65 : 1,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "900" }}>
              Clear
            </Text>
          </Pressable>
        </View>

        {latestAppointment ? (
          <View
            style={{
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 12,
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "800" }}>
              Latest appointment loaded
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 19,
                marginTop: 6,
              }}
            >
              {latestAppointment.client_name || "Unnamed client"} on{" "}
              {latestAppointment.appointment_date || "unknown date"} at{" "}
              {latestAppointment.appointment_time || "unknown time"}
            </Text>
            <Text
              selectable
              style={{
                color: colors.mutedText,
                fontSize: 12,
                lineHeight: 18,
                marginTop: 6,
              }}
            >
              {latestAppointment.id}
            </Text>
          </View>
        ) : null}

        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            gap: 10,
            marginBottom: 12,
          }}
        >
          {(
            [
              ["confirmation", "Send Confirmation"],
              ["update", "Send Update"],
              ["cancellation", "Send Cancellation"],
              ["reminder", "Send Reminder"],
            ] as const
          ).map(([messageType, label]) => (
            <Pressable
              key={messageType}
              disabled={smsSending || latestAppointmentLoading}
              onPress={() => {
                void sendTestSms(messageType);
              }}
              style={{
                backgroundColor: colors.background,
                borderColor: colors.border,
                borderWidth: 1,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 11,
                opacity: smsSending || latestAppointmentLoading ? 0.65 : 1,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View
          style={{
            backgroundColor: colors.background,
            borderColor: colors.border,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 13,
              fontWeight: "800",
              marginBottom: 6,
            }}
          >
            Last SMS test result
          </Text>
          <Text
            selectable
            style={{
              color: colors.mutedText,
              fontSize: 12,
              lineHeight: 18,
            }}
          >
            {smsResult ||
              "No test has been run yet. This panel will show the exact function result or skip code."}
          </Text>
        </View>
      </View>

      <Pressable
        onPress={confirmReset}
        style={{
          borderColor: "#DC2626",
          borderWidth: 1,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "#DC2626", fontSize: 16, fontWeight: "900" }}>
          Reset Checklist
        </Text>
      </Pressable>
    </AppScreen>
  );
}
