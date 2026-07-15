import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
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
import { sendManualClientEmail } from "../lib/appointmentEmail";
import { sendManualClientSms } from "../lib/appointmentSms";
import { useAuthSession } from "../lib/authSession";
import { resolveClientReply } from "../lib/clientReplies";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { openSchedovaProScreen, PRO_UPSELL_COPY } from "../lib/proUpsell";
import {
  subscribeToSaveNotices,
  type SaveNotice,
} from "../lib/saveNoticeEvents";
import { supabase } from "../lib/supabase";
import { useScreenLoadingTiming } from "../lib/screenPerformance";
import { useAppTheme } from "../lib/useAppTheme";
import { useSmsBalance } from "../lib/useSmsBalance";

type SmsReplyRow = {
  id: string;
  user_id?: string | null;
  account_id?: string | null;
  client_id?: string | null;
  appointment_id?: string | null;
  conversation_id?: string | null;
  channel?: "sms" | "email" | null;
  direction?: "inbound" | "outbound" | null;
  sender?: string | null;
  recipient?: string | null;
  subject?: string | null;
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

type MessageFilter = "all" | "sms" | "email";
type ReplyChannel = "sms" | "email";

type ClientSummary = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  sms_opt_in?: boolean | null;
  email_opt_in?: boolean | null;
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

function isMissingMessagesTableError(error?: { code?: string; message?: string } | null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    message.includes("could not find the table") ||
    message.includes("public.messages") ||
    message.includes('relation "public.messages" does not exist')
  );
}

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
  const { authStatus, isHydrated, userId } = useAuthSession();
  const featureAccess = useFeatureAccess();
  const smsBalance = useSmsBalance({
    userId,
    subscription: featureAccess.subscription,
  });
  const clientRepliesAvailable = canUseFeature("smsAutomation");
  const [loading, setLoading] = useState(true);
  useScreenLoadingTiming(loading);
  const [messages, setMessages] = useState<SmsReplyRow[]>([]);
  const [clientsById, setClientsById] = useState<Record<string, ClientSummary>>({});
  const [appointmentsById, setAppointmentsById] = useState<
    Record<string, AppointmentSummary>
  >({});
  const [selectedMessage, setSelectedMessage] = useState<SmsReplyRow | null>(null);
  const [selectedConversationMessages, setSelectedConversationMessages] =
    useState<SmsReplyRow[]>([]);
  const [messageFilter, setMessageFilter] = useState<MessageFilter>("all");
  const [replyChannel, setReplyChannel] = useState<ReplyChannel>("sms");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [setupError, setSetupError] = useState("");

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
          message.direction === "inbound" &&
          !message.resolved_at &&
          (!message.read_at || Boolean(message.needs_attention)),
      ).length,
    [messages],
  );

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = subscribeToSaveNotices((notice) => {
      setSaveNotice(notice);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        setSaveNotice((current) =>
          current?.id === notice.id ? null : current,
        );
      }, 2500);
    });

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
    };
  }, []);

  const conversationCards = useMemo(() => {
    const filteredMessages =
      messageFilter === "all"
        ? messages
        : messages.filter((message) => message.channel === messageFilter);
    const byConversation = new Map<string, SmsReplyRow[]>();

    filteredMessages.forEach((message) => {
      const key = String(message.conversation_id || message.id);
      const current = byConversation.get(key) || [];
      current.push(message);
      byConversation.set(key, current);
    });

    return Array.from(byConversation.entries())
      .map(([conversationId, rows]) => {
        const sorted = rows.sort(
          (left, right) =>
            new Date(right.created_at || 0).getTime() -
            new Date(left.created_at || 0).getTime(),
        );
        const latest = sorted[0];
        const unreadCount = rows.filter(
          (message) => message.direction === "inbound" && !message.read_at,
        ).length;
        const needsAttention = rows.some(
          (message) => message.needs_attention && !message.resolved_at,
        );

        return {
          conversationId,
          latest,
          messages: sorted,
          unreadCount,
          needsAttention,
        };
      })
      .sort(
        (left, right) =>
          new Date(right.latest.created_at || 0).getTime() -
          new Date(left.latest.created_at || 0).getTime(),
      );
  }, [messageFilter, messages]);

  const selectedClient = selectedMessage?.client_id
    ? clientsById[selectedMessage.client_id]
    : null;
  const selectedAppointment = selectedMessage?.appointment_id
    ? appointmentsById[selectedMessage.appointment_id]
    : null;
  const selectedClientCanReplyByText = Boolean(
    selectedClient?.phone && selectedClient?.sms_opt_in,
  );
  const selectedClientCanReplyByEmail = Boolean(
    selectedClient?.email && selectedClient?.email_opt_in,
  );
  const selectedClientTextIssue = !selectedClient?.phone
    ? "Add a phone number before replying by text."
    : !selectedClient?.sms_opt_in
      ? "Turn on SMS appointment messages before replying by text."
      : "";
  const selectedClientEmailIssue = !selectedClient?.email
    ? "Add an email address before replying by email."
    : !selectedClient?.email_opt_in
      ? "Turn on email appointment messages before replying by email."
      : "";

  useEffect(() => {
    if (authStatus === "authenticated" && userId) {
      return;
    }

    setMessages([]);
    setClientsById({});
    setAppointmentsById({});
    setSelectedMessage(null);
    setSelectedConversationMessages([]);
    setResolving(false);
    setSetupError("");
    setLoading(authStatus === "loading");
  }, [authStatus, userId]);

  const fetchMessages = useCallback(async () => {
    if (!clientRepliesAvailable) {
      setMessages([]);
      setClientsById({});
      setAppointmentsById({});
      setSetupError("");
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
      setMessages([]);
      setClientsById({});
      setAppointmentsById({});
      setSelectedMessage(null);
      setSetupError("");
      setLoading(false);
      return;
    }

    console.log("Messages current user id", userId);
    setSetupError("");

    const openedAt = new Date().toISOString();
    const { error: markReadError } = await supabase
      .from("messages")
      .update({ read_at: openedAt })
      .eq("account_id", userId)
      .eq("direction", "inbound")
      .is("read_at", null);

    if (markReadError) {
      if (isMissingMessagesTableError(markReadError)) {
        setMessages([]);
        setClientsById({});
        setAppointmentsById({});
        setSelectedMessage(null);
        setSetupError(
          "Messages database setup is missing. Apply the public.messages migration, then reload the app.",
        );
        setLoading(false);
        return;
      }

      console.log("MESSAGES MARK READ ERROR:", markReadError.message);
    }

    const { data: logRows, error: logsError } = await supabase
      .from("messages")
      .select(
        "id, account_id, client_id, appointment_id, conversation_id, channel, direction, sender, recipient, subject, body, status, provider_message_id, created_at, needs_attention, attention_reason, read_at, resolved_at",
      )
      .eq("account_id", userId)
      .order("created_at", { ascending: false });

    if (logsError) {
      if (isMissingMessagesTableError(logsError)) {
        setMessages([]);
        setClientsById({});
        setAppointmentsById({});
        setSelectedMessage(null);
        setSetupError(
          "Messages database setup is missing. Apply the public.messages migration, then reload the app.",
        );
        setLoading(false);
        return;
      }

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
            .select("id, name, phone, email, sms_opt_in, email_opt_in")
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
  }, [clientRepliesAvailable, isHydrated, userId]);

  useFocusEffect(
    useCallback(() => {
      void fetchMessages();
    }, [fetchMessages]),
  );

  async function openMessage(message: SmsReplyRow) {
    let nextMessage = message;
    const conversationId = String(message.conversation_id || message.id);
    const conversationRows = messages
      .filter(
        (row) => String(row.conversation_id || row.id) === conversationId,
      )
      .sort(
        (left, right) =>
          new Date(left.created_at || 0).getTime() -
          new Date(right.created_at || 0).getTime(),
      );

    if (message.direction === "inbound" && !message.read_at) {
      const readAt = new Date().toISOString();
      const { error } = await supabase
        .from("messages")
        .update({ read_at: readAt })
        .eq("conversation_id", conversationId)
        .eq("account_id", userId)
        .eq("direction", "inbound")
        .is("read_at", null);

      if (error) {
        Alert.alert("Error", error.message);
      } else {
        nextMessage = {
          ...message,
          read_at: readAt,
        };
        setMessages((current) =>
          current.map((row) =>
            String(row.conversation_id || row.id) === conversationId &&
            row.direction === "inbound"
              ? { ...row, read_at: row.read_at || readAt }
              : row,
          ),
        );
      }
    }

    setSelectedMessage(nextMessage);
    setSelectedConversationMessages(conversationRows);
    setReplyChannel(message.channel === "email" ? "email" : "sms");
    setReplySubject(message.subject || "Message from your provider");
    setReplyBody("");
  }

  async function markResolved(message?: SmsReplyRow) {
    const targetMessage = message || selectedMessage;
    if (!targetMessage || resolving) return;

    setResolving(true);
    try {
      if (targetMessage.channel === "email") {
        const resolvedAt = new Date().toISOString();
        const { error } = await supabase
          .from("messages")
          .update({
            resolved_at: resolvedAt,
            needs_attention: false,
            read_at: targetMessage.read_at || resolvedAt,
          })
          .eq("id", targetMessage.id)
          .eq("account_id", targetMessage.account_id || userId);

        if (error) throw error;

        if (targetMessage.appointment_id) {
          await supabase
            .from("appointments")
            .update({
              needs_attention: false,
              attention_reason: null,
            })
            .eq("id", targetMessage.appointment_id)
            .eq("user_id", targetMessage.account_id || userId);
        }

        setSelectedMessage(null);
        setSelectedConversationMessages([]);
        await fetchMessages();
        setResolving(false);
        return;
      }

      const result = await resolveClientReply({
        messageId: targetMessage.id,
        userId: String(targetMessage.user_id || targetMessage.account_id || ""),
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

  function openEditClientById(clientId?: string | null) {
    const cleanClientId = String(clientId || "").trim();

    if (!cleanClientId) return;

    setSelectedMessage(null);
    router.push({
      pathname: "/edit-client",
      params: { clientId: cleanClientId },
    } as any);
  }

  function openEditClient() {
    openEditClientById(selectedMessage?.client_id);
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

  async function sendReply() {
    if (!selectedMessage || sendingReply) return;

    const cleanBody = replyBody.trim();
    if (!cleanBody) {
      Alert.alert("Reply required", "Type a message before sending.");
      return;
    }

    if (!selectedMessage.client_id) {
      Alert.alert("Client required", "This conversation is not linked to a client.");
      return;
    }

    const client = selectedClient;

    if (replyChannel === "email") {
      if (!client?.email || !client.email_opt_in) {
        Alert.alert("Email unavailable", selectedClientEmailIssue, [
          { text: "Cancel", style: "cancel" },
          { text: "Edit Client", onPress: openEditClient },
        ]);
        return;
      }

      setSendingReply(true);
      try {
        const result = await sendManualClientEmail({
          clientId: selectedMessage.client_id,
          appointmentId: selectedMessage.appointment_id || null,
          conversationId: selectedMessage.conversation_id || null,
          subject: replySubject.trim() || "Message from your provider",
          messageBody: cleanBody,
        });

        if (!result.ok) {
          Alert.alert(
            "Email not sent",
            result.message || "Email could not be sent. Please try again.",
          );
          return;
        }

        setReplyBody("");
        await fetchMessages();
      } catch (error) {
        console.log("Email reply failed", error);
        Alert.alert("Email not sent", "Email could not be sent. Please try again.");
      } finally {
        setSendingReply(false);
      }
      return;
    }

    if (!client?.phone || !client.sms_opt_in) {
      Alert.alert("Text unavailable", selectedClientTextIssue, [
        { text: "Cancel", style: "cancel" },
        { text: "Edit Client", onPress: openEditClient },
      ]);
      return;
    }

    setSendingReply(true);
    try {
      const result = await sendManualClientSms({
        clientId: selectedMessage.client_id,
        appointmentId: selectedMessage.appointment_id || null,
        conversationId: selectedMessage.conversation_id || null,
        messageBody: cleanBody,
      });

      if (!result.ok) {
        Alert.alert(
          "Text not sent",
          result.message || "Text could not be sent. Please try again.",
        );
        return;
      }

      setReplyBody("");
      await fetchMessages();
    } catch (error) {
      console.log("Text reply failed", error);
      Alert.alert("Text not sent", "Text could not be sent. Please try again.");
    } finally {
      setSendingReply(false);
    }
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
          title="Messages"
          subtitle="Review text replies and outbound emails."
          showBack
        />

        <ProGateCard
          title="Client replies"
          message={PRO_UPSELL_COPY.emailMessaging}
          features={[
            "See text replies and outbound email history in one place",
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
        title="Messages"
        subtitle="Review text replies and outbound emails in one place."
        showBack
      />

      {saveNotice ? (
        <AppCard
          style={{
            borderColor: infoAccent,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontWeight: "900",
              textAlign: "center",
            }}
          >
            {saveNotice.message}
          </Text>
        </AppCard>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          gap: 8,
          marginBottom: 14,
        }}
      >
        {[
          { label: "All", value: "all" as const },
          { label: "Text", value: "sms" as const },
          { label: "Email", value: "email" as const },
        ].map((filter) => {
          const selected = messageFilter === filter.value;

          return (
            <Pressable
              key={filter.value}
              accessibilityRole="button"
              onPress={() => setMessageFilter(filter.value)}
              style={{
                minHeight: 42,
                paddingHorizontal: 14,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: selected ? colors.primary : polishedBorder,
                backgroundColor: selected ? colors.primary : colors.card,
              }}
            >
              <Text
                style={{
                  color: selected ? "#FFFFFF" : colors.text,
                  fontWeight: "900",
                }}
              >
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

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

      {setupError ? (
        <AppCard
          style={{
            borderColor: attentionAccent,
            borderLeftColor: attentionAccent,
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
              marginBottom: 8,
            }}
          >
            Messages setup needed
          </Text>
          <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
            {setupError}
          </Text>
        </AppCard>
      ) : loading ? (
        <View style={{ alignItems: "center", paddingVertical: 36 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedText, marginTop: 12 }}>
            Loading client replies...
          </Text>
        </View>
      ) : conversationCards.length === 0 ? (
        <EmptyState
          title="No messages yet"
          message="Text replies and outbound emails will appear here. Email replies go to your normal email inbox for now."
        />
      ) : (
        conversationCards.map((conversation) => {
          const message = conversation.latest;
          const client = message.client_id ? clientsById[message.client_id] : null;
          const appointment = message.appointment_id
            ? appointmentsById[message.appointment_id]
            : null;
          const preview = buildMessagePreview(message);
          const cardBorder = conversation.needsAttention
            ? attentionAccent
            : message.resolved_at
              ? resolvedAccent
              : infoAccent;
          const channelIcon =
            message.channel === "email" ? "Email outbound" : "Text";

          return (
            <AppCard
              key={conversation.conversationId}
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
                      String(message.sender || message.from_number || "Unknown client")}
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
                  <Badge
                    label={channelIcon}
                    backgroundColor={infoAccentSoft}
                    textColor={infoAccent}
                  />
                  {conversation.needsAttention ? (
                    <Badge
                      label="Attention"
                      backgroundColor={attentionAccentSoft}
                      textColor={attentionAccent}
                    />
                  ) : null}
                  {conversation.unreadCount > 0 ? (
                    <Badge
                      label={`${conversation.unreadCount} unread`}
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

              <View style={{ marginTop: 12, gap: 8 }}>
                {message.client_id ? (
                  <AppButton
                    title="Edit Client"
                    variant="secondary"
                    onPress={(event) => {
                      event.stopPropagation();
                      openEditClientById(message.client_id);
                    }}
                  />
                ) : null}
                <AppButton
                  title={message.resolved_at ? "Resolved" : "Mark resolved"}
                  variant={message.resolved_at ? "ghost" : "secondary"}
                  disabled={Boolean(message.resolved_at) || resolving}
                  loading={resolving && selectedMessage?.id === message.id}
                  onPress={(event) => {
                    event.stopPropagation();
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
            onPress={() => {
              setSelectedMessage(null);
              setSelectedConversationMessages([]);
            }}
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
                    String(
                      selectedMessage?.sender ||
                        selectedMessage?.from_number ||
                        "Client reply",
                    )}
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
                onPress={() => {
                  setSelectedMessage(null);
                  setSelectedConversationMessages([]);
                }}
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

              <View style={{ marginTop: 18, gap: 10 }}>
                {(selectedConversationMessages.length
                  ? selectedConversationMessages
                  : selectedMessage
                    ? [selectedMessage]
                    : []
                ).map((message) => {
                  const outbound = message.direction === "outbound";
                  const channelLabel =
                    message.channel === "email" ? "Email outbound-only" : "Text";

                  return (
                    <AppCard
                      key={message.id}
                      variant="subtle"
                      style={{
                        borderColor: polishedBorder,
                        borderWidth: 1,
                        alignSelf: outbound ? "flex-end" : "stretch",
                        maxWidth: outbound ? "94%" : "100%",
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          justifyContent: "space-between",
                          gap: 10,
                          marginBottom: 8,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.mutedText,
                            fontSize: 12,
                            fontWeight: "900",
                            textTransform: "uppercase",
                          }}
                        >
                          {outbound ? "Sent" : "Received"} by {channelLabel}
                        </Text>
                        <Text style={{ color: colors.mutedText, fontSize: 12 }}>
                          {formatMessageTimestamp(message.created_at)}
                        </Text>
                      </View>
                      {message.subject ? (
                        <Text
                          style={{
                            color: colors.text,
                            fontWeight: "900",
                            marginBottom: 8,
                          }}
                        >
                          {message.subject}
                        </Text>
                      ) : null}
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 16,
                          lineHeight: 24,
                        }}
                      >
                        {String(
                          message.message_body || message.body || "No message text",
                        ).trim() || "No message text"}
                      </Text>
                    </AppCard>
                  );
                })}
              </View>

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
                    String(
                      selectedMessage?.sender ||
                        selectedMessage?.from_number ||
                        "No matched client",
                    )}
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
                    color: colors.text,
                    fontSize: 16,
                    fontWeight: "900",
                    marginBottom: 10,
                  }}
                >
                  Reply
                </Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  {[
                    {
                      label: "Text",
                      value: "sms" as const,
                      disabled: !selectedClientCanReplyByText,
                    },
                    {
                      label: "Email",
                      value: "email" as const,
                      disabled: !selectedClientCanReplyByEmail,
                    },
                  ].map((option) => {
                    const selected = replyChannel === option.value;

                    return (
                      <Pressable
                        key={option.value}
                        accessibilityRole="button"
                        disabled={option.disabled}
                        onPress={() => setReplyChannel(option.value)}
                        style={{
                          minHeight: 40,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : polishedBorder,
                          backgroundColor: selected ? colors.primary : colors.card,
                          opacity: option.disabled ? 0.45 : 1,
                        }}
                      >
                        <Text
                          style={{
                            color: selected ? "#FFFFFF" : colors.text,
                            fontWeight: "900",
                          }}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Text
                  style={{
                    color: colors.mutedText,
                    lineHeight: 20,
                    marginBottom: 12,
                  }}
                >
                  {replyChannel === "email"
                    ? "Email does not use SMS credits. Replies go to your email inbox for now."
                    : smsBalance.loading
                      ? "Text uses 1 SMS credit. Loading balance..."
                      : `Text uses 1 SMS credit. Balance: ${smsBalance.balance.balance}`}
                </Text>
                {replyChannel === "sms" && selectedClientTextIssue ? (
                  <View style={{ marginBottom: 12, gap: 8 }}>
                    <Text style={{ color: attentionAccent, lineHeight: 20 }}>
                      {selectedClientTextIssue}
                    </Text>
                    <AppButton
                      title="Edit Client"
                      variant="secondary"
                      disabled={!selectedMessage?.client_id}
                      onPress={openEditClient}
                    />
                  </View>
                ) : null}
                {replyChannel === "email" && selectedClientEmailIssue ? (
                  <View style={{ marginBottom: 12, gap: 8 }}>
                    <Text style={{ color: attentionAccent, lineHeight: 20 }}>
                      {selectedClientEmailIssue}
                    </Text>
                    <AppButton
                      title="Edit Client"
                      variant="secondary"
                      disabled={!selectedMessage?.client_id}
                      onPress={openEditClient}
                    />
                  </View>
                ) : null}
                {replyChannel === "email" ? (
                  <TextInput
                    value={replySubject}
                    onChangeText={setReplySubject}
                    placeholder="Subject"
                    placeholderTextColor={colors.mutedText}
                    style={{
                      minHeight: 48,
                      borderWidth: 1,
                      borderColor: polishedBorder,
                      borderRadius: 14,
                      paddingHorizontal: 12,
                      color: colors.text,
                      backgroundColor: colors.background,
                      marginBottom: 12,
                    }}
                  />
                ) : null}
                <TextInput
                  value={replyBody}
                  onChangeText={setReplyBody}
                  placeholder={
                    replyChannel === "email"
                      ? "Write an email message..."
                      : "Write a text reply..."
                  }
                  placeholderTextColor={colors.mutedText}
                  multiline
                  textAlignVertical="top"
                  style={{
                    minHeight: 96,
                    borderWidth: 1,
                    borderColor: polishedBorder,
                    borderRadius: 14,
                    padding: 12,
                    color: colors.text,
                    backgroundColor: colors.background,
                    marginBottom: 12,
                  }}
                />
                <AppButton
                  title={sendingReply ? "Sending..." : `Send by ${replyChannel === "email" ? "Email" : "Text"}`}
                  loading={sendingReply}
                  disabled={sendingReply}
                  onPress={() => {
                    void sendReply();
                  }}
                />
              </AppCard>

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
                  title="Edit Client"
                  variant="secondary"
                  disabled={!selectedMessage?.client_id}
                  onPress={openEditClient}
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
