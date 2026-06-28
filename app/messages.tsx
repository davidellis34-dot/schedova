import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  EmptyState,
  ProGateCard,
  ScreenHeader,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import { resolveClientReply } from "../lib/clientReplies";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { openSchedovaProScreen, PRO_UPSELL_COPY } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type SmsReplyRow = {
  id: string;
  user_id: string;
  client_id?: string | null;
  appointment_id?: string | null;
  body?: string | null;
  message_body?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  status?: string | null;
  provider_message_id?: string | null;
  created_at?: string | null;
  needs_attention?: boolean | null;
  attention_reason?: string | null;
  read_at?: string | null;
  resolved_at?: string | null;
};

type ClientSummary = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
};

type AppointmentSummary = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  service_ids?: string[] | null;
  status?: string | null;
  needs_attention?: boolean | null;
  attention_reason?: string | null;
};

function formatMessageTimestamp(value?: string | null) {
  if (!value) return "Unknown time";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAppointmentDateTime(appointment?: AppointmentSummary | null) {
  if (!appointment?.appointment_date) return "No appointment linked";

  const date = new Date(`${appointment.appointment_date}T12:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? appointment.appointment_date
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  const timeText = String(appointment.appointment_time || "").slice(0, 5);
  if (!timeText) return dateLabel;

  const timeDate = new Date(`2000-01-01T${timeText}:00`);
  const timeLabel = Number.isNaN(timeDate.getTime())
    ? timeText
    : timeDate.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });

  return `${dateLabel} at ${timeLabel}`;
}

function buildMessagePreview(message: SmsReplyRow) {
  const fullMessage = String(message.message_body || message.body || "").trim();
  if (!fullMessage) return "No message text";
  if (fullMessage.length <= 110) return fullMessage;
  return `${fullMessage.slice(0, 107)}...`;
}

function Badge({
  label,
  backgroundColor,
  textColor,
}: {
  label: string;
  backgroundColor: string;
  textColor: string;
}) {
  return (
    <View
      style={{
        backgroundColor,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
    >
      <Text
        style={{
          color: textColor,
          fontSize: 11,
          fontWeight: "800",
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export default function MessagesScreen() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const { isHydrated, userId } = useAuthSession();
  useFeatureAccess();
  const clientRepliesAvailable = canUseFeature("smsAutomation");
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<SmsReplyRow[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, ClientSummary>>({});
  const [appointmentsById, setAppointmentsById] = useState<
    Record<string, AppointmentSummary>
  >({});
  const [selectedMessage, setSelectedMessage] = useState<SmsReplyRow | null>(null);
  const [resolving, setResolving] = useState(false);

  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const attentionAccent = "#D97706";
  const attentionAccentSoft = isDarkTheme
    ? "rgba(217, 119, 6, 0.24)"
    : "rgba(217, 119, 6, 0.14)";
  const resolvedAccent = "#0F766E";
  const resolvedAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.22)"
    : "rgba(15, 118, 110, 0.14)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  const unreadOrAttentionCount = useMemo(
    () =>
      messages.filter(
        (message) =>
          !message.resolved_at &&
          (!message.read_at || Boolean(message.needs_attention)),
      ).length,
    [messages],
  );

  const selectedClient = selectedMessage?.client_id
    ? clientsById[selectedMessage.client_id]
    : null;
  const selectedAppointment = selectedMessage?.appointment_id
    ? appointmentsById[selectedMessage.appointment_id]
    : null;

  const fetchMessages = useCallback(async () => {
    if (!clientRepliesAvailable) {
      setMessages([]);
      setClientsById({});
      setAppointmentsById({});
      setLoading(false);
      console.log("Messages access blocked by Pro gate");
      return;
    }

    if (!isHydrated) {
      setLoading(true);
      return;
    }

    setLoading(true);

    if (!userId) {
      setLoading(false);
      router.replace("/login" as any);
      return;
    }

    console.log("Messages current user id", userId);

    const openedAt = new Date().toISOString();
    const { error: markReadError } = await supabase
      .from("sms_message_logs")
      .update({ read_at: openedAt })
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .is("read_at", null);

    if (markReadError) {
      console.log("MESSAGES MARK READ ERROR:", markReadError.message);
    }

    const { data: logRows, error: logsError } = await supabase
      .from("sms_message_logs")
      .select(
        "id, user_id, client_id, appointment_id, body, message_body, from_number, to_number, status, provider_message_id, created_at, needs_attention, attention_reason, read_at, resolved_at",
      )
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false });

    if (logsError) {
      setLoading(false);
      Alert.alert("Error", logsError.message);
      return;
    }

    const safeMessages = ((logRows || []).filter(Boolean) as SmsReplyRow[]) || [];
    console.log("Messages loaded", safeMessages);
    setMessages(safeMessages);

    const clientIds = Array.from(
      new Set(
        safeMessages
          .map((message) => String(message.client_id || "").trim())
          .filter(Boolean),
      ),
    );
    const appointmentIds = Array.from(
      new Set(
        safeMessages
          .map((message) => String(message.appointment_id || "").trim())
          .filter(Boolean),
      ),
    );

    const [clientsResult, appointmentsResult] = await Promise.all([
      clientIds.length > 0
        ? supabase
            .from("clients")
            .select("id, name, phone, email")
            .eq("user_id", userId)
            .in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),
      appointmentIds.length > 0
        ? supabase
            .from("appointments")
            .select(
              "id, client_id, client_name, appointment_date, appointment_time, end_time, duration_minutes, service_ids, status, needs_attention, attention_reason",
            )
            .eq("user_id", userId)
            .in("id", appointmentIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (clientsResult.error) {
      Alert.alert("Error", clientsResult.error.message);
    }

    if (appointmentsResult.error) {
      Alert.alert("Error", appointmentsResult.error.message);
    }

    const nextClientsById = Object.fromEntries(
      ((clientsResult.data || []) as ClientSummary[])
        .filter((client) => client?.id)
        .map((client) => [String(client.id), client]),
    );
    const nextAppointmentsById = Object.fromEntries(
      ((appointmentsResult.data || []) as AppointmentSummary[])
        .filter((appointment) => appointment?.id)
        .map((appointment) => [String(appointment.id), appointment]),
    );

    setClientsById(nextClientsById);
    setAppointmentsById(nextAppointmentsById);
    setLoading(false);
  }, [clientRepliesAvailable, isHydrated, router, userId]);

  useFocusEffect(
    useCallback(() => {
      void fetchMessages();
    }, [fetchMessages]),
  );

  async function openMessage(message: SmsReplyRow) {
    let nextMessage = message;

    if (!message.read_at) {
      const readAt = new Date().toISOString();
      const { error } = await supabase
        .from("sms_message_logs")
        .update({ read_at: readAt })
        .eq("id", message.id)
        .eq("user_id", message.user_id);

      if (error) {
        Alert.alert("Error", error.message);
      } else {
        nextMessage = {
          ...message,
          read_at: readAt,
        };
        setMessages((current) =>
          current.map((row) => (row.id === message.id ? nextMessage : row)),
        );
      }
    }

    setSelectedMessage(nextMessage);
  }

  async function markResolved(message?: SmsReplyRow) {
    const targetMessage = message || selectedMessage;
    if (!targetMessage || resolving) return;

    setResolving(true);
    try {
      const result = await resolveClientReply({
        messageId: targetMessage.id,
        userId: targetMessage.user_id,
        appointmentId: targetMessage.appointment_id,
      });

      console.log("Mark resolved result", {
        messageId: result.messageId,
        appointmentId: result.appointmentId,
        clearedAppointmentAttention: result.clearedAppointmentAttention,
      });

      setSelectedMessage(null);
      await fetchMessages();
      setResolving(false);
    } catch (error) {
      setResolving(false);
      Alert.alert(
        "Error",
        error instanceof Error ? error.message : "Could not mark this reply resolved.",
      );
    }
  }

  function openClient() {
    if (!selectedMessage?.client_id) return;

    setSelectedMessage(null);
    router.push({
      pathname: "/client-details",
      params: { clientId: selectedMessage.client_id },
    } as any);
  }

  function openAppointment() {
    if (!selectedMessage?.appointment_id) return;

    setSelectedMessage(null);
    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentId: selectedMessage.appointment_id,
        mode: "edit",
      },
    } as any);
  }

  function getSelectedClientName() {
    return (
      String(selectedClient?.name || "").trim() ||
      String(selectedAppointment?.client_name || "").trim() ||
      ""
    );
  }

  function getSelectedAppointmentServiceIds() {
    return Array.isArray(selectedAppointment?.service_ids)
      ? selectedAppointment.service_ids
          .map((serviceId) => String(serviceId || "").trim())
          .filter(Boolean)
      : [];
  }

  function buildReplyBookingParams(mode: "create" | "reschedule") {
    const serviceIds = getSelectedAppointmentServiceIds();
    const clientName = getSelectedClientName();
    const params: Record<string, string> = {
      mode,
      clientId: String(selectedMessage?.client_id || ""),
      clientName,
      replyId: String(selectedMessage?.id || ""),
      replyClientId: String(selectedMessage?.client_id || ""),
      replyAppointmentId: String(selectedMessage?.appointment_id || ""),
      returnTo: "/messages",
    };

    if (mode === "reschedule" && selectedMessage?.appointment_id) {
      params.appointmentId = selectedMessage.appointment_id;
    }

    if (selectedAppointment?.appointment_date) {
      params.appointmentDate = selectedAppointment.appointment_date;
    }

    if (selectedAppointment?.appointment_time) {
      params.appointmentTime = selectedAppointment.appointment_time;
    }

    if (selectedAppointment?.end_time) {
      params.endTime = selectedAppointment.end_time;
    }

    if (serviceIds.length > 0) {
      params.serviceIds = serviceIds.join(",");
    }

    if (
      selectedAppointment?.duration_minutes !== null &&
      selectedAppointment?.duration_minutes !== undefined
    ) {
      params.durationMinutes = String(selectedAppointment.duration_minutes);
    }

    return params;
  }

  function logReplyBookingNavigation(params: Record<string, string>) {
    console.log("Reply id", selectedMessage?.id || null);
    console.log("Linked client id", selectedMessage?.client_id || null);
    console.log("Linked appointment id", selectedMessage?.appointment_id || null);
    console.log("Navigation target", "/book-appointment");
    console.log("Prefill params passed to booking form", params);
  }

  function openRescheduleAppointment() {
    if (!selectedMessage?.client_id || !selectedMessage?.appointment_id) return;

    const params = buildReplyBookingParams("reschedule");
    logReplyBookingNavigation(params);

    setSelectedMessage(null);
    router.push({
      pathname: "/book-appointment",
      params,
    } as any);
  }

  function openBookNewAppointment() {
    if (!selectedMessage?.client_id) return;

    const params = buildReplyBookingParams("create");
    logReplyBookingNavigation(params);

    setSelectedMessage(null);
    router.push({
      pathname: "/book-appointment",
      params,
    } as any);
  }

  if (!clientRepliesAvailable) {
    return (
      <AppScreen scroll backgroundColor={colors.background} bottomPadding={72}>
        <ScreenHeader
          title="Client Replies"
          subtitle="Review client text replies and follow up."
          showBack
        />

        <ProGateCard
          title="Client replies"
          message={PRO_UPSELL_COPY.sms}
          features={[
            "See inbound appointment replies in one place",
            "Flag reschedule and cancel requests for follow-up",
            "Resolve replies after you handle the client",
          ]}
          ctaLabel="Upgrade to Schedova Pro"
          onPress={openSchedovaProScreen}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={72}>
      <ScreenHeader
        title="Client Replies"
        subtitle="Review client text replies and follow up."
        showBack
      />

      <AppCard
        variant="subtle"
        style={{
          borderColor: unreadOrAttentionCount > 0 ? attentionAccent : polishedBorder,
          borderLeftColor: unreadOrAttentionCount > 0 ? attentionAccent : infoAccent,
          borderLeftWidth: 4,
          borderWidth: 1,
          marginBottom: 18,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 17,
            fontWeight: "900",
            marginBottom: 6,
          }}
        >
          Replies to review
        </Text>
        <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
          {unreadOrAttentionCount > 0
            ? `${unreadOrAttentionCount} inbound reply${unreadOrAttentionCount === 1 ? "" : "ies"} is unread or flagged for follow-up.`
            : "You are all caught up on inbound appointment replies."}
        </Text>
      </AppCard>

      {loading ? (
        <View style={{ alignItems: "center", paddingVertical: 36 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedText, marginTop: 12 }}>
            Loading client replies...
          </Text>
        </View>
      ) : messages.length === 0 ? (
        <EmptyState
          title="No client replies yet"
          message="When clients reply to appointment texts, they'll appear here."
        />
      ) : (
        messages.map((message) => {
          const client = message.client_id ? clientsById[message.client_id] : null;
          const appointment = message.appointment_id
            ? appointmentsById[message.appointment_id]
            : null;
          const preview = buildMessagePreview(message);
          const cardBorder = message.needs_attention
            ? attentionAccent
            : message.resolved_at
              ? resolvedAccent
              : infoAccent;

          return (
            <AppCard
              key={message.id}
              onPress={() => {
                void openMessage(message);
              }}
              variant="subtle"
              style={{
                marginBottom: 12,
                borderColor: polishedBorder,
                borderLeftColor: cardBorder,
                borderLeftWidth: 4,
                borderWidth: 1,
                opacity: message.resolved_at ? 0.88 : 1,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "flex-start",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    {String(client?.name || "").trim() ||
                      String(appointment?.client_name || "").trim() ||
                      String(message.from_number || "Unknown client")}
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedText,
                      fontSize: 12,
                      marginTop: 3,
                    }}
                  >
                    {formatMessageTimestamp(message.created_at)}
                  </Text>
                </View>

                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {message.needs_attention ? (
                    <Badge
                      label="Attention"
                      backgroundColor={attentionAccentSoft}
                      textColor={attentionAccent}
                    />
                  ) : null}
                  {!message.read_at ? (
                    <Badge
                      label="Unread"
                      backgroundColor={infoAccentSoft}
                      textColor={infoAccent}
                    />
                  ) : null}
                  {message.resolved_at ? (
                    <Badge
                      label="Resolved"
                      backgroundColor={resolvedAccentSoft}
                      textColor={resolvedAccent}
                    />
                  ) : null}
                </View>
              </View>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 15,
                  lineHeight: 22,
                  marginTop: 12,
                }}
                numberOfLines={3}
              >
                {preview}
              </Text>

              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: 12,
                  marginTop: 10,
                }}
              >
                {appointment
                  ? `Appointment: ${formatAppointmentDateTime(appointment)}`
                  : "No appointment linked"}
              </Text>

              <View style={{ marginTop: 12 }}>
                <AppButton
                  title={message.resolved_at ? "Resolved" : "Mark resolved"}
                  variant={message.resolved_at ? "ghost" : "secondary"}
                  disabled={Boolean(message.resolved_at) || resolving}
                  loading={resolving && selectedMessage?.id === message.id}
                  onPress={() => {
                    setSelectedMessage(message);
                    void markResolved(message);
                  }}
                />
              </View>
            </AppCard>
          );
        })
      )}

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <Pressable
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
            }}
            onPress={() => setSelectedMessage(null)}
          />

          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 22,
              borderWidth: 1,
              borderColor: polishedBorder,
              maxHeight: "90%",
              overflow: "hidden",
            }}
          >
            <View
              style={{
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 16,
                borderBottomWidth: 1,
                borderBottomColor: polishedBorder,
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 22,
                    fontWeight: "900",
                  }}
                >
                  {String(selectedClient?.name || "").trim() ||
                    String(selectedAppointment?.client_name || "").trim() ||
                    String(selectedMessage?.from_number || "Client reply")}
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    marginTop: 4,
                  }}
                >
                  {formatMessageTimestamp(selectedMessage?.created_at)}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                onPress={() => setSelectedMessage(null)}
                hitSlop={10}
              >
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 18,
                    fontWeight: "700",
                  }}
                >
                  Close
                </Text>
              </Pressable>
            </View>

            <ScrollView
              style={{ width: "100%" }}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 18,
                paddingBottom: 40,
              }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                {selectedMessage?.needs_attention ? (
                  <Badge
                    label="Needs attention"
                    backgroundColor={attentionAccentSoft}
                    textColor={attentionAccent}
                  />
                ) : null}
                {!selectedMessage?.read_at ? (
                  <Badge
                    label="Unread"
                    backgroundColor={infoAccentSoft}
                    textColor={infoAccent}
                  />
                ) : null}
                {selectedMessage?.resolved_at ? (
                  <Badge
                    label="Resolved"
                    backgroundColor={resolvedAccentSoft}
                    textColor={resolvedAccent}
                  />
                ) : null}
              </View>

              <AppCard
                variant="subtle"
                style={{
                  marginTop: 18,
                  borderColor: polishedBorder,
                  borderWidth: 1,
                }}
              >
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Full message
                </Text>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 16,
                    lineHeight: 24,
                  }}
                >
                  {String(
                    selectedMessage?.message_body ||
                      selectedMessage?.body ||
                      "No message text",
                  ).trim() || "No message text"}
                </Text>
              </AppCard>

              <AppCard
                variant="subtle"
                style={{
                  marginTop: 14,
                  borderColor: polishedBorder,
                  borderWidth: 1,
                }}
              >
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Linked client
                </Text>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: "800" }}>
                  {String(selectedClient?.name || "").trim() ||
                    String(selectedMessage?.from_number || "No matched client")}
                </Text>
                <Text style={{ color: colors.mutedText, marginTop: 4 }}>
                  {selectedClient?.phone || selectedClient?.email || "No client contact on file"}
                </Text>
              </AppCard>

              <AppCard
                variant="subtle"
                style={{
                  marginTop: 14,
                  borderColor: polishedBorder,
                  borderWidth: 1,
                }}
              >
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    fontWeight: "800",
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  Linked appointment
                </Text>
                <Text style={{ color: colors.text, fontSize: 15, fontWeight: "800" }}>
                  {formatAppointmentDateTime(selectedAppointment)}
                </Text>
                <Text style={{ color: colors.mutedText, marginTop: 4 }}>
                  {selectedAppointment?.status
                    ? `Status: ${selectedAppointment.status}`
                    : "No appointment matched"}
                </Text>
              </AppCard>

              {selectedMessage?.attention_reason ? (
                <AppCard
                  variant="subtle"
                  style={{
                    marginTop: 14,
                    borderColor: attentionAccent,
                    borderLeftColor: attentionAccent,
                    borderLeftWidth: 4,
                    borderWidth: 1,
                  }}
                >
                  <Text
                    style={{
                      color: attentionAccent,
                      fontSize: 12,
                      fontWeight: "900",
                      textTransform: "uppercase",
                      marginBottom: 6,
                    }}
                  >
                    Attention reason
                  </Text>
                  <Text style={{ color: colors.text, lineHeight: 21 }}>
                    {selectedMessage.attention_reason}
                  </Text>
                </AppCard>
              ) : null}

              <View style={{ marginTop: 18, gap: 10 }}>
                {selectedMessage?.client_id && selectedMessage?.appointment_id ? (
                  <AppButton
                    title="Reschedule Appointment"
                    variant="primary"
                    onPress={openRescheduleAppointment}
                  />
                ) : null}
                {selectedMessage?.client_id ? (
                  <AppButton
                    title="Book New Appointment"
                    variant="secondary"
                    onPress={openBookNewAppointment}
                  />
                ) : null}
                <AppButton
                  title="View Client"
                  variant="secondary"
                  disabled={!selectedMessage?.client_id}
                  onPress={openClient}
                />
                <AppButton
                  title="View Appointment"
                  variant="secondary"
                  disabled={!selectedMessage?.appointment_id}
                  onPress={openAppointment}
                />
                <AppButton
                  title={selectedMessage?.resolved_at ? "Resolved" : "Mark Resolved"}
                  variant={selectedMessage?.resolved_at ? "ghost" : "primary"}
                  disabled={Boolean(selectedMessage?.resolved_at) || resolving}
                  loading={resolving}
                  onPress={() => {
                    void markResolved(selectedMessage || undefined);
                  }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </AppScreen>
  );
}
