import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  type LayoutChangeEvent,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import {
  getConversationHeaderActionOutcome,
  getConversationThreadLayout,
} from "../lib/conversationThreadLayout";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { resolveThreadOpenTarget } from "../lib/messagesThreadUtils";
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

type OpenMessageOptions = {
  channelFilter?: ReplyChannel;
  sourceMessages?: SmsReplyRow[];
};

type ConversationCard = {
  conversationId: string;
  latest: SmsReplyRow;
  latestReviewMessage: SmsReplyRow | null;
  messages: SmsReplyRow[];
  unreadCount: number;
  needsAttention: boolean;
  repliesToReviewCount: number;
  hasRepliesToReview: boolean;
  isResolved: boolean;
};

type ResolveUndoNotice = {
  id: number;
  conversationId: string;
  previousMessages: SmsReplyRow[];
};

const DRAFT_THREAD_PREFIX = "draft-client-thread:";

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

function getConversationDayKey(value?: string | null) {
  if (!value) return "unknown";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatConversationDayLabel(value?: string | null) {
  if (!value) return "Today";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const today = new Date();
  const todayKey = getConversationDayKey(today.toISOString());
  const dateKey = getConversationDayKey(value);

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = getConversationDayKey(yesterday.toISOString());

  if (dateKey === todayKey) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
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

function readRouteParam(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }

  return String(value || "");
}

function normalizeComparablePhone(value?: string | null) {
  return String(value || "").replace(/\D/g, "");
}

function phoneNumbersMatch(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeComparablePhone(left);
  const normalizedRight = normalizeComparablePhone(right);

  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  return (
    normalizedLeft.length >= 10 &&
    normalizedRight.length >= 10 &&
    (normalizedLeft.endsWith(normalizedRight) ||
      normalizedRight.endsWith(normalizedLeft))
  );
}

function getComparableMessagePhones(message: SmsReplyRow) {
  return [
    message.sender,
    message.recipient,
    message.from_number,
    message.to_number,
  ]
    .map((value) => normalizeComparablePhone(value))
    .filter(Boolean);
}

function messageMatchesClientPhone(
  message: SmsReplyRow,
  normalizedClientPhone?: string | null,
) {
  const cleanClientPhone = normalizeComparablePhone(normalizedClientPhone);
  if (!cleanClientPhone) return false;

  return getComparableMessagePhones(message).some((value) =>
    phoneNumbersMatch(value, cleanClientPhone),
  );
}

function getMessageCreatedAtTime(message?: SmsReplyRow | null) {
  return new Date(message?.created_at || 0).getTime();
}

function getConversationId(message?: Pick<SmsReplyRow, "id" | "conversation_id"> | null) {
  return String(message?.conversation_id || message?.id || "").trim();
}

function findLatestMessageInConversation(
  rows: SmsReplyRow[],
  conversationId?: string | null,
  channel?: ReplyChannel,
) {
  const cleanConversationId = String(conversationId || "").trim();
  if (!cleanConversationId) return null;

  return (
    [...rows]
      .filter(
        (row) =>
          String(row.conversation_id || row.id) === cleanConversationId &&
          (!channel || row.channel === channel),
      )
      .sort(
        (left, right) =>
          getMessageCreatedAtTime(right) - getMessageCreatedAtTime(left),
      )[0] || null
  );
}

function findLatestSmsMessageForClientThread(
  rows: SmsReplyRow[],
  clientId?: string | null,
  normalizedClientPhone?: string | null,
) {
  const cleanClientId = String(clientId || "").trim();
  const smsRows = [...rows]
    .filter((row) => row.channel === "sms")
    .sort(
      (left, right) =>
        getMessageCreatedAtTime(right) - getMessageCreatedAtTime(left),
    );

  const phoneMatches = normalizedClientPhone
    ? smsRows.filter((row) => messageMatchesClientPhone(row, normalizedClientPhone))
    : [];

  if (cleanClientId) {
    const clientPhoneMatches = phoneMatches.filter(
      (row) => String(row.client_id || "").trim() === cleanClientId,
    );
    if (clientPhoneMatches.length > 0) {
      return clientPhoneMatches[0];
    }
  }

  if (phoneMatches.length > 0) {
    return phoneMatches[0];
  }

  if (!cleanClientId) return null;

  return (
    smsRows.find((row) => String(row.client_id || "").trim() === cleanClientId) ||
    null
  );
}

function isDraftMessage(message?: Pick<SmsReplyRow, "id"> | null) {
  return String(message?.id || "").startsWith(DRAFT_THREAD_PREFIX);
}

function isReplyNeedingReview(message: SmsReplyRow) {
  return (
    message.direction === "inbound" &&
    !message.resolved_at &&
    (!message.read_at || Boolean(message.needs_attention))
  );
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
  const safeAreaInsets = useSafeAreaInsets();
  const routeParams = useLocalSearchParams<{
    openClientId?: string | string[];
    openClientPhone?: string | string[];
    openClientName?: string | string[];
    openRequestAt?: string | string[];
  }>();
  const { colors, themeName } = useAppTheme();
  const { authStatus, isHydrated, userId } = useAuthSession();
  const featureAccess = useFeatureAccess();
  const smsBalance = useSmsBalance({
    userId,
    subscription: featureAccess.subscription,
  });
  const clientRepliesAvailable = canUseFeature("clientReplies");
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
  const [reviewFilterActive, setReviewFilterActive] = useState(false);
  const [replyChannel, setReplyChannel] = useState<ReplyChannel>("sms");
  const [replySubject, setReplySubject] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [savingResolutionConversationId, setSavingResolutionConversationId] =
    useState<string | null>(null);
  const [deletingConversation, setDeletingConversation] = useState(false);
  const [resolveUndoNotice, setResolveUndoNotice] =
    useState<ResolveUndoNotice | null>(null);
  const [saveNotice, setSaveNotice] = useState<SaveNotice | null>(null);
  const [setupError, setSetupError] = useState("");
  const [shouldScrollToReviewResults, setShouldScrollToReviewResults] =
    useState(false);
  const [conversationMenuVisible, setConversationMenuVisible] = useState(false);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const threadScrollRef = useRef<ScrollView | null>(null);
  const resultsSectionYRef = useRef(0);
  const handledOpenRequestRef = useRef("");
  const resolveUndoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingUndoSnapshotsRef = useRef(new Map<string, SmsReplyRow[]>());
  const nextResolveUndoNoticeIdRef = useRef(1);
  const conversationMenuTranslateY = useRef(new Animated.Value(28)).current;
  const conversationMenuOverlayOpacity = useRef(new Animated.Value(0)).current;

  const openClientId = readRouteParam(routeParams.openClientId).trim();
  const openClientPhone = readRouteParam(routeParams.openClientPhone).trim();
  const openClientName = readRouteParam(routeParams.openClientName).trim();
  const openRequestAt = readRouteParam(routeParams.openRequestAt).trim();

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
  const conversationMenuSurface = "#0F172A";
  const conversationMenuBorder = "rgba(45, 212, 191, 0.22)";
  const conversationMenuOverlayColor = "rgba(2, 6, 23, 0.72)";
  const conversationThreadLayout = getConversationThreadLayout(safeAreaInsets);

  const resetConversationMenuState = useCallback(() => {
    conversationMenuTranslateY.stopAnimation();
    conversationMenuOverlayOpacity.stopAnimation();
    conversationMenuTranslateY.setValue(28);
    conversationMenuOverlayOpacity.setValue(0);
    setConversationMenuVisible(false);
  }, [conversationMenuOverlayOpacity, conversationMenuTranslateY]);

  const restoreConversationMenuPosition = useCallback(() => {
    Animated.parallel([
      Animated.spring(conversationMenuTranslateY, {
        toValue: 0,
        friction: 10,
        tension: 80,
        useNativeDriver: true,
      }),
      Animated.timing(conversationMenuOverlayOpacity, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  }, [conversationMenuOverlayOpacity, conversationMenuTranslateY]);

  const hideConversationMenu = useCallback(
    (callback?: () => void) => {
      if (!conversationMenuVisible) {
        resetConversationMenuState();
        callback?.();
        return;
      }

      Animated.parallel([
        Animated.timing(conversationMenuTranslateY, {
          toValue: 28,
          duration: 170,
          useNativeDriver: true,
        }),
        Animated.timing(conversationMenuOverlayOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        resetConversationMenuState();
        if (finished) {
          callback?.();
        }
      });
    },
    [
      conversationMenuOverlayOpacity,
      conversationMenuTranslateY,
      conversationMenuVisible,
      resetConversationMenuState,
    ],
  );

  const conversationMenuPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          conversationMenuVisible &&
          gestureState.dy > 8 &&
          Math.abs(gestureState.dy) > Math.abs(gestureState.dx),
        onPanResponderMove: (_, gestureState) => {
          const nextOffset = Math.max(0, gestureState.dy);
          conversationMenuTranslateY.setValue(nextOffset);
          conversationMenuOverlayOpacity.setValue(Math.max(0, 1 - nextOffset / 240));
        },
        onPanResponderRelease: (_, gestureState) => {
          if (gestureState.dy > 96 || gestureState.vy > 0.9) {
            hideConversationMenu();
            return;
          }

          restoreConversationMenuPosition();
        },
        onPanResponderTerminate: restoreConversationMenuPosition,
      }),
    [
      conversationMenuOverlayOpacity,
      conversationMenuTranslateY,
      conversationMenuVisible,
      hideConversationMenu,
      restoreConversationMenuPosition,
    ],
  );

  const handleResultsSectionLayout = useCallback(
    (event: LayoutChangeEvent) => {
      resultsSectionYRef.current = event.nativeEvent.layout.y;
    },
    [],
  );

  const toggleReviewFilter = useCallback(() => {
    const next = !reviewFilterActive;
    setReviewFilterActive(next);
    setShouldScrollToReviewResults(next);
  }, [reviewFilterActive]);

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

  useEffect(() => {
    return () => {
      if (resolveUndoTimeoutRef.current) {
        clearTimeout(resolveUndoTimeoutRef.current);
      }
    };
  }, []);

  const conversationCards = useMemo<ConversationCard[]>(() => {
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
        const reviewMessages = sorted.filter(isReplyNeedingReview);
        const latestReviewMessage = reviewMessages[0] || null;
        const isResolved = rows.length > 0 && rows.every((message) => Boolean(message.resolved_at));

        return {
          conversationId,
          latest,
          latestReviewMessage,
          messages: sorted,
          unreadCount,
          needsAttention,
          repliesToReviewCount: reviewMessages.length,
          hasRepliesToReview: reviewMessages.length > 0,
          isResolved,
        };
      })
      .sort(
        (left, right) =>
          new Date(right.latest.created_at || 0).getTime() -
          new Date(left.latest.created_at || 0).getTime(),
      );
  }, [messageFilter, messages]);

  const openConversationCards = useMemo(
    () => conversationCards.filter((conversation) => !conversation.isResolved),
    [conversationCards],
  );

  const resolvedConversationCards = useMemo(
    () => conversationCards.filter((conversation) => conversation.isResolved),
    [conversationCards],
  );

  const repliesToReviewCount = useMemo(
    () => messages.filter(isReplyNeedingReview).length,
    [messages],
  );

  const visibleOpenConversationCards = useMemo(() => {
    if (!reviewFilterActive) return openConversationCards;

    return openConversationCards
      .filter((conversation) => conversation.hasRepliesToReview)
      .sort(
        (left, right) =>
          new Date(
            right.latestReviewMessage?.created_at ||
              right.latest.created_at ||
              0,
          ).getTime() -
          new Date(
            left.latestReviewMessage?.created_at || left.latest.created_at || 0,
          ).getTime(),
      );
  }, [openConversationCards, reviewFilterActive]);

  const visibleResolvedConversationCards = useMemo(
    () => (reviewFilterActive ? [] : resolvedConversationCards),
    [resolvedConversationCards, reviewFilterActive],
  );

  const selectedClient = selectedMessage?.client_id
    ? clientsById[selectedMessage.client_id]
    : null;
  const selectedAppointment = selectedMessage?.appointment_id
    ? appointmentsById[selectedMessage.appointment_id]
    : null;
  const selectedMessageIsDraft = isDraftMessage(selectedMessage);
  const selectedConversationToRender = selectedMessageIsDraft
    ? selectedConversationMessages
    : selectedConversationMessages.length
      ? selectedConversationMessages
      : selectedMessage
        ? [selectedMessage]
        : [];
  const selectedClientCanReplyByText = Boolean(
    selectedClient?.phone && selectedClient?.sms_opt_in,
  );
  const selectedClientCanReplyByEmail = Boolean(
    selectedClient?.email && selectedClient?.email_opt_in,
  );
  const selectedThreadTitle =
    String(selectedClient?.name || "").trim() ||
    String(selectedAppointment?.client_name || "").trim() ||
    String(selectedMessage?.sender || selectedMessage?.from_number || "Client reply");
  const selectedThreadContact = String(
    selectedClient?.phone ||
      selectedClient?.email ||
      selectedMessage?.recipient ||
      selectedMessage?.sender ||
      selectedMessage?.to_number ||
      selectedMessage?.from_number ||
      "",
  ).trim();
  const threadSurface = isDarkTheme ? "#0F172A" : "#F3F6FB";
  const incomingBubbleColor = isDarkTheme ? "#1F2937" : "#FFFFFF";
  const outgoingBubbleColor = colors.primary;
  const outgoingBubbleTextColor = "#FFFFFF";
  const threadSystemBubbleColor = isDarkTheme
    ? "rgba(148, 163, 184, 0.16)"
    : "rgba(15, 23, 42, 0.06)";
  const composerSurface = isDarkTheme ? "#111827" : "#FFFFFF";
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
  const conversationMenuActions = [
    {
      key: "client-details",
      label: "View Client Details",
      description: selectedMessage?.client_id
        ? "Open the linked client profile."
        : "This conversation is not linked to a client yet.",
      disabled: !selectedMessage?.client_id,
      onPress: openClient,
    },
    {
      key: "book-appointment",
      label: "Book Appointment",
      description: selectedMessage?.client_id
        ? "Create a new appointment for this client."
        : "Link this conversation to a client to book an appointment.",
      disabled: !selectedMessage?.client_id,
      onPress: openBookNewAppointment,
    },
    {
      key: "reschedule-appointment",
      label: "Reschedule Appointment",
      description: selectedMessage?.appointment_id
        ? "Move the linked appointment to a new time."
        : "No appointment is linked to this conversation yet.",
      disabled: !selectedMessage?.appointment_id || !selectedMessage?.client_id,
      onPress: openRescheduleAppointment,
    },
  ];

  useEffect(() => {
    if (selectedMessage) return;
    resetConversationMenuState();
  }, [resetConversationMenuState, selectedMessage]);

  useEffect(() => {
    if (authStatus === "authenticated" && userId) {
      return;
    }

    setMessages([]);
    setClientsById({});
    setAppointmentsById({});
    resetConversationMenuState();
    setSelectedMessage(null);
    setSelectedConversationMessages([]);
    setSavingResolutionConversationId(null);
    setDeletingConversation(false);
    setResolveUndoNotice(null);
    pendingUndoSnapshotsRef.current.clear();
    if (resolveUndoTimeoutRef.current) {
      clearTimeout(resolveUndoTimeoutRef.current);
      resolveUndoTimeoutRef.current = null;
    }
    setSetupError("");
    setReviewFilterActive(false);
    setShouldScrollToReviewResults(false);
    handledOpenRequestRef.current = "";
    setLoading(authStatus === "loading");
  }, [authStatus, resetConversationMenuState, userId]);

  useEffect(() => {
    if (!shouldScrollToReviewResults) return;

    if (!reviewFilterActive || visibleOpenConversationCards.length === 0) {
      setShouldScrollToReviewResults(false);
      return;
    }

    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        scrollViewRef.current?.scrollTo({
          y: Math.max(resultsSectionYRef.current - 12, 0),
          animated: true,
        });
        setShouldScrollToReviewResults(false);
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) {
        cancelAnimationFrame(secondFrame);
      }
    };
  }, [
    reviewFilterActive,
    shouldScrollToReviewResults,
    visibleOpenConversationCards.length,
  ]);

  const fetchMessages = useCallback(async () => {
    if (!clientRepliesAvailable) {
      setMessages([]);
      setClientsById({});
      setAppointmentsById({});
      setSetupError("");
      setLoading(false);
      console.log("Messages access blocked by Pro gate");
      return [] as SmsReplyRow[];
    }

    if (!isHydrated) {
      setLoading(true);
      return [] as SmsReplyRow[];
    }

    setLoading(true);

    if (!userId) {
      setMessages([]);
      setClientsById({});
      setAppointmentsById({});
      setSelectedMessage(null);
      setSetupError("");
      setLoading(false);
      return [] as SmsReplyRow[];
    }

    console.log("Messages current user id", userId);
    setSetupError("");

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
        return [] as SmsReplyRow[];
      }

      setLoading(false);
      Alert.alert("Error", logsError.message);
      return [] as SmsReplyRow[];
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
    return safeMessages;
  }, [clientRepliesAvailable, isHydrated, userId]);

  const ensureClientLoaded = useCallback(
    async (clientId?: string | null) => {
      const cleanClientId = String(clientId || "").trim();
      if (!cleanClientId || !userId) return null;

      const existingClient = clientsById[cleanClientId];
      if (existingClient) return existingClient;

      const { data, error } = await supabase
        .from("clients")
        .select("id, name, phone, email, sms_opt_in, email_opt_in")
        .eq("user_id", userId)
        .eq("id", cleanClientId)
        .maybeSingle();

      if (error) {
        console.log("Could not load client for message thread", error.message);
        return null;
      }

      const client = (data as ClientSummary | null) || null;
      if (client?.id) {
        setClientsById((current) =>
          current[cleanClientId]
            ? current
            : {
                ...current,
                [cleanClientId]: client,
              },
        );
      }

      return client;
    },
    [clientsById, userId],
  );

  useFocusEffect(
    useCallback(() => {
      void fetchMessages();
    }, [fetchMessages]),
  );

  const openMessage = useCallback(
    async (message: SmsReplyRow, options: OpenMessageOptions = {}) => {
      let nextMessage = message;
      const conversationId = String(message.conversation_id || message.id);
      const sourceMessages = options.sourceMessages || messages;
      let conversationRows = sourceMessages
        .filter(
          (row) =>
            String(row.conversation_id || row.id) === conversationId &&
            (!options.channelFilter || row.channel === options.channelFilter),
        )
        .sort(
          (left, right) =>
            new Date(left.created_at || 0).getTime() -
            new Date(right.created_at || 0).getTime(),
        );

      if (message.direction === "inbound" && !message.read_at) {
        const readAt = new Date().toISOString();
        let query = supabase
          .from("messages")
          .update({ read_at: readAt })
          .eq("conversation_id", conversationId)
          .eq("account_id", userId)
          .eq("direction", "inbound")
          .is("read_at", null);

        if (options.channelFilter) {
          query = query.eq("channel", options.channelFilter);
        }

        const { error } = await query;

        if (error) {
          Alert.alert("Error", error.message);
        } else {
          nextMessage = {
            ...message,
            read_at: readAt,
          };
          conversationRows = conversationRows.map((row) =>
            row.direction === "inbound"
              ? { ...row, read_at: row.read_at || readAt }
              : row,
          );
          setMessages((current) =>
            current.map((row) =>
              String(row.conversation_id || row.id) === conversationId &&
              row.direction === "inbound" &&
              (!options.channelFilter || row.channel === options.channelFilter)
                ? { ...row, read_at: row.read_at || readAt }
                : row,
            ),
          );
        }
      }

      setSelectedMessage(nextMessage);
      setSelectedConversationMessages(conversationRows);
      setReplyChannel(
        options.channelFilter === "email"
          ? "email"
          : options.channelFilter === "sms"
            ? "sms"
            : message.channel === "email"
              ? "email"
              : "sms",
      );
      setReplySubject(message.subject || "Message from your provider");
      setReplyBody("");
    },
    [messages, userId],
  );

  useEffect(() => {
    const requestKey = [openRequestAt, openClientId, openClientPhone].join(":");
    if (!requestKey || !openRequestAt || !openClientId) return;
    if (handledOpenRequestRef.current === requestKey) return;
    if (!clientRepliesAvailable || !isHydrated || !userId || loading) return;

    handledOpenRequestRef.current = requestKey;

    let cancelled = false;

    const openRequestedThread = async () => {
      const loadedClient = await ensureClientLoaded(openClientId);
      if (cancelled) return;

      const threadTarget = resolveThreadOpenTarget({
        clientId: openClientId,
        clientName: openClientName,
        clientPhone: openClientPhone,
        loadedClientName: loadedClient?.name,
        loadedClientPhone: loadedClient?.phone,
        messages,
      });

      if (threadTarget.existingMessage) {
        await openMessage(threadTarget.existingMessage, {
          channelFilter: "sms",
          sourceMessages: messages,
        });
        return;
      }

      setSelectedMessage(threadTarget.draftMessage);
      setSelectedConversationMessages([]);
      setReplyChannel("sms");
      setReplySubject("Message from your provider");
      setReplyBody("");
    };

    void openRequestedThread();

    return () => {
      cancelled = true;
    };
  }, [
    clientRepliesAvailable,
    ensureClientLoaded,
    isHydrated,
    loading,
    messages,
    openClientId,
    openClientName,
    openClientPhone,
    openMessage,
    openRequestAt,
    userId,
  ]);

  async function clearAppointmentAttentionForConversation(rows: SmsReplyRow[]) {
    if (!userId) return;

    const appointmentIds = Array.from(
      new Set(
        rows
          .map((row) => String(row.appointment_id || "").trim())
          .filter(Boolean),
      ),
    );

    await Promise.all(
      appointmentIds.map(async (appointmentId) => {
        const { count, error } = await supabase
          .from("messages")
          .select("id", { count: "exact", head: true })
          .eq("account_id", userId)
          .eq("appointment_id", appointmentId)
          .eq("direction", "inbound")
          .is("resolved_at", null);

        if (error || (count || 0) > 0) return;

        await supabase
          .from("appointments")
          .update({
            needs_attention: false,
            attention_reason: null,
          })
          .eq("id", appointmentId)
          .eq("user_id", userId);
      }),
    );
  }

  function replaceConversationRows(
    currentMessages: SmsReplyRow[],
    conversationId: string,
    nextRows: SmsReplyRow[],
  ) {
    const nextRowsById = new Map(nextRows.map((row) => [row.id, row]));

    return currentMessages.map((row) =>
      getConversationId(row) === conversationId
        ? (nextRowsById.get(row.id) || row)
        : row,
    );
  }

  function clearResolveUndoNotice(conversationId?: string | null) {
    if (resolveUndoTimeoutRef.current) {
      clearTimeout(resolveUndoTimeoutRef.current);
      resolveUndoTimeoutRef.current = null;
    }

    setResolveUndoNotice((current) => {
      if (!current) return null;
      if (conversationId && current.conversationId !== conversationId) {
        return current;
      }

      return null;
    });
  }

  function showResolveUndoNotice(notice: Omit<ResolveUndoNotice, "id">) {
    if (resolveUndoTimeoutRef.current) {
      clearTimeout(resolveUndoTimeoutRef.current);
    }

    const nextNotice = {
      ...notice,
      id: nextResolveUndoNoticeIdRef.current++,
    } satisfies ResolveUndoNotice;

    setResolveUndoNotice(nextNotice);
    resolveUndoTimeoutRef.current = setTimeout(() => {
      setResolveUndoNotice((current) =>
        current?.id === nextNotice.id ? null : current,
      );
      resolveUndoTimeoutRef.current = null;
    }, 5000);
  }

  async function persistConversationResolution(
    message: SmsReplyRow,
    resolved: boolean,
    timestamp: string,
  ) {
    if (!userId) {
      throw new Error("You must be signed in to update this conversation.");
    }

    let query = supabase
      .from("messages")
      .update(
        resolved
          ? {
              resolved_at: timestamp,
              read_at: timestamp,
              needs_attention: false,
              attention_reason: null,
            }
          : {
              resolved_at: null,
              needs_attention: false,
              attention_reason: null,
            },
      )
      .eq("account_id", userId);

    query = message.conversation_id
      ? query.eq("conversation_id", message.conversation_id)
      : query.eq("id", message.id);

    const { error } = await query;
    if (error) throw error;
  }

  async function persistConversationSnapshot(previousMessages: SmsReplyRow[]) {
    if (!userId) {
      throw new Error("You must be signed in to update this conversation.");
    }

    await Promise.all(
      previousMessages.map(async (row) => {
        const { error } = await supabase
          .from("messages")
          .update({
            resolved_at: row.resolved_at || null,
            read_at: row.read_at || null,
            needs_attention: Boolean(row.needs_attention),
            attention_reason: row.attention_reason || null,
          })
          .eq("account_id", userId)
          .eq("id", row.id);

        if (error) {
          throw error;
        }
      }),
    );
  }

  async function updateConversationResolution(
    message: SmsReplyRow | null | undefined,
    resolved: boolean,
  ) {
    const targetMessage = message || selectedMessage;
    if (!targetMessage || savingResolutionConversationId || !userId) return;

    const conversationId = getConversationId(targetMessage);
    if (!conversationId) return;

    const previousMessages = messages
      .filter((row) => getConversationId(row) === conversationId)
      .map((row) => ({ ...row }));

    if (previousMessages.length === 0) return;

    const timestamp = new Date().toISOString();
    const optimisticMessages = previousMessages.map((row) =>
      resolved
        ? {
            ...row,
            resolved_at: timestamp,
            read_at: row.read_at || timestamp,
            needs_attention: false,
            attention_reason: null,
          }
        : {
            ...row,
            resolved_at: null,
            needs_attention: false,
            attention_reason: null,
          },
    );

    setSavingResolutionConversationId(conversationId);
    setMessages((current) =>
      replaceConversationRows(current, conversationId, optimisticMessages),
    );

    if (resolved) {
      if (getConversationId(selectedMessage) === conversationId) {
        closeSelectedThread();
      }

      showResolveUndoNotice({
        conversationId,
        previousMessages,
      });
    } else {
      clearResolveUndoNotice(conversationId);
    }

    try {
      await persistConversationResolution(targetMessage, resolved, timestamp);

      if (resolved) {
        await clearAppointmentAttentionForConversation(previousMessages);
      }

      const pendingUndoSnapshot = pendingUndoSnapshotsRef.current.get(conversationId);
      if (resolved && pendingUndoSnapshot) {
        pendingUndoSnapshotsRef.current.delete(conversationId);

        try {
          await persistConversationSnapshot(pendingUndoSnapshot);
        } catch (undoError) {
          setMessages((current) =>
            replaceConversationRows(current, conversationId, optimisticMessages),
          );
          Alert.alert(
            "Undo failed",
            undoError instanceof Error
              ? undoError.message
              : "The conversation stayed resolved.",
          );
        }
      }
    } catch (error) {
      const undoWasRequested = pendingUndoSnapshotsRef.current.has(conversationId);
      pendingUndoSnapshotsRef.current.delete(conversationId);

      if (!undoWasRequested) {
        setMessages((current) =>
          replaceConversationRows(current, conversationId, previousMessages),
        );
        clearResolveUndoNotice(conversationId);
        Alert.alert(
          "Error",
          error instanceof Error
            ? error.message
            : resolved
              ? "Could not resolve this conversation."
              : "Could not reopen this conversation.",
        );
      }
    } finally {
      setSavingResolutionConversationId((current) =>
        current === conversationId ? null : current,
      );
    }
  }

  async function markResolved(message?: SmsReplyRow) {
    await updateConversationResolution(message, true);
  }

  async function reopenConversation(message?: SmsReplyRow) {
    await updateConversationResolution(message, false);
  }

  function undoResolvedConversation() {
    if (!resolveUndoNotice) {
      return;
    }

    const { conversationId, previousMessages } = resolveUndoNotice;
    const targetMessage = previousMessages[0];
    clearResolveUndoNotice(conversationId);

    if (!targetMessage) {
      return;
    }

    if (savingResolutionConversationId === conversationId) {
      pendingUndoSnapshotsRef.current.set(conversationId, previousMessages);
      setMessages((current) =>
        replaceConversationRows(current, conversationId, previousMessages),
      );
      return;
    }

    const resolvedMessages = messages
      .filter((row) => getConversationId(row) === conversationId)
      .map((row) => ({ ...row }));

    setSavingResolutionConversationId(conversationId);
    setMessages((current) =>
      replaceConversationRows(current, conversationId, previousMessages),
    );

    void (async () => {
      try {
        await persistConversationSnapshot(previousMessages);
      } catch (error) {
        setMessages((current) =>
          replaceConversationRows(current, conversationId, resolvedMessages),
        );
        Alert.alert(
          "Undo failed",
          error instanceof Error
            ? error.message
            : "The conversation stayed resolved.",
        );
      } finally {
        setSavingResolutionConversationId((current) =>
          current === conversationId ? null : current,
        );
      }
    })();
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
        const refreshedMessages = await fetchMessages();
        const reopenedMessage =
          findLatestMessageInConversation(
            refreshedMessages,
            result.conversationId || selectedMessage.conversation_id,
            "email",
          ) ||
          findLatestMessageInConversation(
            refreshedMessages,
            selectedMessage.conversation_id,
            "email",
          );

        if (reopenedMessage) {
          await openMessage(reopenedMessage, {
            channelFilter: "email",
            sourceMessages: refreshedMessages,
          });
        }
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
      const refreshedMessages = await fetchMessages();
      const clientPhone =
        String(selectedClient?.phone || "").trim() ||
        String(selectedMessage.recipient || "").trim() ||
        String(selectedMessage.sender || "").trim() ||
        String(selectedMessage.to_number || "").trim() ||
        String(selectedMessage.from_number || "").trim();
      const reopenedMessage =
        findLatestMessageInConversation(
          refreshedMessages,
          result.conversationId || selectedMessage.conversation_id,
          "sms",
        ) ||
        findLatestSmsMessageForClientThread(
          refreshedMessages,
          selectedMessage.client_id,
          clientPhone,
        );

      if (reopenedMessage) {
        await openMessage(reopenedMessage, {
          channelFilter: "sms",
          sourceMessages: refreshedMessages,
        });
      }
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

  function closeSelectedThread() {
    if (!getConversationHeaderActionOutcome("close").closeThread) return;

    Keyboard.dismiss();
    resetConversationMenuState();
    setSelectedMessage(null);
    setSelectedConversationMessages([]);
  }

  function openConversationMenu() {
    if (!selectedMessage || !getConversationHeaderActionOutcome("more").openOptions) {
      return;
    }

    conversationMenuTranslateY.stopAnimation();
    conversationMenuOverlayOpacity.stopAnimation();
    conversationMenuTranslateY.setValue(28);
    conversationMenuOverlayOpacity.setValue(0);
    setConversationMenuVisible(true);

    requestAnimationFrame(() => {
      restoreConversationMenuPosition();
    });
  }

  useEffect(() => {
    if (!selectedMessage) return;

    const frameId = requestAnimationFrame(() => {
      threadScrollRef.current?.scrollToEnd({ animated: false });
    });

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, [selectedConversationToRender.length, selectedMessage]);

  function renderSectionHeader(
    title: string,
    subtitle: string,
    count: number,
    accentColor: string,
  ) {
    return (
      <View style={{ marginBottom: 12 }}>
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginBottom: 4,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "900",
            }}
          >
            {title}
          </Text>
          <Badge
            label={`${count}`}
            backgroundColor={`${accentColor}22`}
            textColor={accentColor}
          />
        </View>
        <Text style={{ color: colors.mutedText, lineHeight: 20 }}>{subtitle}</Text>
      </View>
    );
  }

  function renderConversationCard(conversation: ConversationCard) {
    const message =
      reviewFilterActive && conversation.latestReviewMessage
        ? conversation.latestReviewMessage
        : conversation.latest;
    const client = message.client_id ? clientsById[message.client_id] : null;
    const appointment = message.appointment_id
      ? appointmentsById[message.appointment_id]
      : null;
    const preview = buildMessagePreview(message);
    const cardBorder = conversation.isResolved
      ? resolvedAccent
      : conversation.needsAttention
        ? attentionAccent
        : infoAccent;
    const channelIcon = message.channel === "email" ? "Email outbound" : "Text";
    const statusLoading =
      savingResolutionConversationId === conversation.conversationId;

    return (
      <AppCard
        key={conversation.conversationId}
        onPress={() => {
          void openMessage(message, {
            channelFilter: message.channel === "email" ? "email" : "sms",
          });
        }}
        variant="subtle"
        style={{
          marginBottom: 12,
          borderColor: polishedBorder,
          borderLeftColor: cardBorder,
          borderLeftWidth: 4,
          borderWidth: 1,
          opacity: conversation.isResolved ? 0.88 : 1,
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
            {!conversation.isResolved && conversation.needsAttention ? (
              <Badge
                label="Attention"
                backgroundColor={attentionAccentSoft}
                textColor={attentionAccent}
              />
            ) : null}
            {reviewFilterActive && conversation.repliesToReviewCount > 0 ? (
              <Badge
                label={`${conversation.repliesToReviewCount} to review`}
                backgroundColor={attentionAccentSoft}
                textColor={attentionAccent}
              />
            ) : null}
            {!conversation.isResolved && conversation.unreadCount > 0 ? (
              <Badge
                label={`${conversation.unreadCount} unread`}
                backgroundColor={infoAccentSoft}
                textColor={infoAccent}
              />
            ) : null}
            {conversation.isResolved ? (
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
            title={conversation.isResolved ? "Reopen Conversation" : "Mark Resolved"}
            variant={conversation.isResolved ? "ghost" : "secondary"}
            disabled={Boolean(savingResolutionConversationId) || deletingConversation}
            loading={statusLoading}
            onPress={(event) => {
              event.stopPropagation();
              void (
                conversation.isResolved
                  ? reopenConversation(message)
                  : markResolved(message)
              );
            }}
          />
        </View>
      </AppCard>
    );
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
          message={PRO_UPSELL_COPY.clientReplies}
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
    <AppScreen
      ref={scrollViewRef}
      scroll
      backgroundColor={colors.background}
      bottomPadding={72}
    >
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

      {resolveUndoNotice ? (
        <AppCard
          style={{
            borderColor: resolvedAccent,
            borderLeftColor: resolvedAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 16,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "900",
                flex: 1,
              }}
            >
              Conversation resolved
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={undoResolvedConversation}
              style={{
                paddingHorizontal: 8,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{
                  color: colors.primary,
                  fontWeight: "900",
                }}
              >
                Undo
              </Text>
            </Pressable>
          </View>
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
        onPress={toggleReviewFilter}
        accessibilityState={{ selected: reviewFilterActive }}
        variant="subtle"
        style={{
          borderColor: reviewFilterActive
            ? attentionAccent
            : repliesToReviewCount > 0
              ? attentionAccent
              : polishedBorder,
          borderLeftColor: reviewFilterActive
            ? attentionAccent
            : repliesToReviewCount > 0
              ? attentionAccent
              : infoAccent,
          borderLeftWidth: 4,
          borderWidth: 1,
          marginBottom: 18,
          backgroundColor: reviewFilterActive ? attentionAccentSoft : undefined,
        }}
      >
        <View
          style={{
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
                fontSize: 17,
                fontWeight: "900",
                marginBottom: 6,
              }}
            >
              Replies to review
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              {repliesToReviewCount > 0
                ? `${repliesToReviewCount} inbound repl${repliesToReviewCount === 1 ? "y is" : "ies are"} unread or flagged for follow-up.`
                : "You are all caught up on inbound appointment replies."}
            </Text>
          </View>
          <Badge
            label={reviewFilterActive ? "Filter active" : "Tap to filter"}
            backgroundColor={attentionAccentSoft}
            textColor={attentionAccent}
          />
        </View>
        <Text
          style={{
            color: reviewFilterActive ? attentionAccent : colors.mutedText,
            lineHeight: 20,
            marginTop: 10,
            fontWeight: reviewFilterActive ? "800" : "600",
          }}
        >
          {reviewFilterActive
            ? "Showing only replies that still need review. Tap again to show all messages."
            : "Tap this summary to focus the list on replies that still need review."}
        </Text>
      </AppCard>

      <View onLayout={handleResultsSectionLayout}>
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
        ) : reviewFilterActive ? (
          visibleOpenConversationCards.length === 0 ? (
            <EmptyState
              title="No replies need review"
              message="Reviewed or resolved replies drop out of this filtered list automatically. Tap the orange summary box again to show all messages."
            />
          ) : (
            <View>
              {renderSectionHeader(
                "Open",
                "Unread messages and conversations still needing attention.",
                visibleOpenConversationCards.length,
                attentionAccent,
              )}
              {visibleOpenConversationCards.map(renderConversationCard)}
            </View>
          )
        ) : conversationCards.length === 0 ? (
          <EmptyState
            title="No messages yet"
            message="Text replies and outbound emails will appear here. Email replies go to your normal email inbox for now."
          />
        ) : (
          <View>
            {renderSectionHeader(
              "Open",
              "Unread messages and conversations still needing attention.",
              openConversationCards.length,
              attentionAccent,
            )}
            {openConversationCards.length === 0 ? (
              <AppCard
                variant="subtle"
                style={{
                  borderColor: polishedBorder,
                  borderWidth: 1,
                  marginBottom: 18,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                  No open conversations
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    lineHeight: 20,
                    marginTop: 8,
                  }}
                >
                  Everything here has been resolved. Older conversations stay below in
                  the Resolved section until you reopen or delete them.
                </Text>
              </AppCard>
            ) : (
              openConversationCards.map(renderConversationCard)
            )}

            <View style={{ marginTop: 12 }}>
              {renderSectionHeader(
                "Resolved",
                "Archived conversations stay here until you reopen them.",
                visibleResolvedConversationCards.length,
                resolvedAccent,
              )}
              {visibleResolvedConversationCards.length === 0 ? (
                <AppCard
                  variant="subtle"
                  style={{
                    borderColor: polishedBorder,
                    borderWidth: 1,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "900", fontSize: 16 }}>
                    No resolved conversations yet
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedText,
                      lineHeight: 20,
                      marginTop: 8,
                    }}
                  >
                    Resolved conversations stay archived here so they do not clutter the
                    main inbox.
                  </Text>
                </AppCard>
              ) : (
                visibleResolvedConversationCards.map(renderConversationCard)
              )}
            </View>
          </View>
        )}
      </View>

      <Modal
        visible={Boolean(selectedMessage)}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeSelectedThread}
      >
        <KeyboardAvoidingView
          style={{ flex: 1, backgroundColor: colors.background }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View
              style={{
                backgroundColor: colors.card,
                borderBottomWidth: 1,
                borderBottomColor: polishedBorder,
                paddingHorizontal: conversationThreadLayout.headerHorizontalPadding,
                paddingTop: conversationThreadLayout.headerPaddingTop,
                paddingBottom: conversationThreadLayout.headerPaddingBottom,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: conversationThreadLayout.headerContentGap,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close conversation"
                  onPress={closeSelectedThread}
                  hitSlop={10}
                  style={{
                    width: conversationThreadLayout.headerActionSize,
                    minWidth: conversationThreadLayout.headerActionSize,
                    minHeight: conversationThreadLayout.headerActionSize,
                    alignItems: "flex-start",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    Close
                  </Text>
                </Pressable>

                <View
                  style={{
                    flex: 1,
                    minWidth: 0,
                    alignItems: "center",
                    paddingHorizontal: 2,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 18,
                      fontWeight: "900",
                      textAlign: "center",
                      width: "100%",
                    }}
                    ellipsizeMode="tail"
                    numberOfLines={1}
                  >
                    {selectedThreadTitle}
                  </Text>
                  {selectedThreadContact ? (
                    <Text
                      style={{
                        color: colors.mutedText,
                        fontSize: 13,
                        marginTop: 2,
                        textAlign: "center",
                        width: "100%",
                      }}
                      ellipsizeMode="tail"
                      numberOfLines={1}
                    >
                      {selectedThreadContact}
                    </Text>
                  ) : null}
                </View>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Conversation options"
                  onPress={openConversationMenu}
                  hitSlop={10}
                  style={{
                    width: conversationThreadLayout.headerActionSize,
                    minWidth: conversationThreadLayout.headerActionSize,
                    minHeight: conversationThreadLayout.headerActionSize,
                    alignItems: "flex-end",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 16,
                      fontWeight: "700",
                    }}
                  >
                    More
                  </Text>
                </Pressable>
              </View>
            </View>

            <ScrollView
              ref={threadScrollRef}
              style={{ flex: 1, backgroundColor: threadSurface }}
              contentContainerStyle={{
                paddingHorizontal: 14,
                paddingTop: 16,
                paddingBottom: 24,
              }}
              onContentSizeChange={() => {
                threadScrollRef.current?.scrollToEnd({ animated: false });
              }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
            >
              {selectedAppointment ? (
                <View style={{ alignItems: "center", marginBottom: 14 }}>
                  <View
                    style={{
                      maxWidth: "90%",
                      borderRadius: 999,
                      backgroundColor: threadSystemBubbleColor,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.mutedText,
                        fontSize: 12,
                        fontWeight: "800",
                        textAlign: "center",
                      }}
                    >
                      {`Appointment • ${formatAppointmentDateTime(selectedAppointment)}`}
                    </Text>
                  </View>
                </View>
              ) : null}

              {!selectedMessageIsDraft && selectedMessage?.attention_reason ? (
                <View style={{ alignItems: "center", marginBottom: 16 }}>
                  <View
                    style={{
                      maxWidth: "90%",
                      borderRadius: 18,
                      backgroundColor: attentionAccentSoft,
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: attentionAccent,
                        fontSize: 12,
                        fontWeight: "900",
                        textTransform: "uppercase",
                        textAlign: "center",
                        marginBottom: 4,
                      }}
                    >
                      Attention
                    </Text>
                    <Text
                      style={{
                        color: colors.text,
                        lineHeight: 20,
                        textAlign: "center",
                      }}
                    >
                      {selectedMessage.attention_reason}
                    </Text>
                  </View>
                </View>
              ) : null}

              {selectedConversationToRender.length > 0 ? (
                selectedConversationToRender.map((message, index) => {
                  const outbound = message.direction === "outbound";
                  const previousMessage =
                    index > 0 ? selectedConversationToRender[index - 1] : null;
                  const showDateSeparator =
                    !previousMessage ||
                    getConversationDayKey(previousMessage.created_at) !==
                      getConversationDayKey(message.created_at);
                  const cleanBody =
                    String(message.message_body || message.body || "No message text")
                      .trim() || "No message text";

                  return (
                    <View key={message.id}>
                      {showDateSeparator ? (
                        <View style={{ alignItems: "center", marginBottom: 14 }}>
                          <View
                            style={{
                              borderRadius: 999,
                              backgroundColor: threadSystemBubbleColor,
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                            }}
                          >
                            <Text
                              style={{
                                color: colors.mutedText,
                                fontSize: 12,
                                fontWeight: "800",
                                textAlign: "center",
                              }}
                            >
                              {formatConversationDayLabel(message.created_at)}
                            </Text>
                          </View>
                        </View>
                      ) : null}

                      <View
                        style={{
                          alignItems: outbound ? "flex-end" : "flex-start",
                          marginBottom: 14,
                        }}
                      >
                        <View
                          style={{
                            maxWidth: "82%",
                            backgroundColor: outbound
                              ? outgoingBubbleColor
                              : incomingBubbleColor,
                            borderWidth: outbound ? 0 : 1,
                            borderColor: polishedBorder,
                            borderRadius: 22,
                            borderBottomRightRadius: outbound ? 8 : 22,
                            borderBottomLeftRadius: outbound ? 22 : 8,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                          }}
                        >
                          {message.channel === "email" ? (
                            <Text
                              style={{
                                color: outbound
                                  ? "rgba(255,255,255,0.78)"
                                  : colors.mutedText,
                                fontSize: 11,
                                fontWeight: "900",
                                textTransform: "uppercase",
                                marginBottom: 6,
                              }}
                            >
                              Email
                            </Text>
                          ) : null}
                          {message.subject ? (
                            <Text
                              style={{
                                color: outbound
                                  ? outgoingBubbleTextColor
                                  : colors.text,
                                fontSize: 13,
                                fontWeight: "900",
                                marginBottom: 8,
                              }}
                            >
                              {message.subject}
                            </Text>
                          ) : null}
                          <Text
                            style={{
                              color: outbound ? outgoingBubbleTextColor : colors.text,
                              fontSize: 16,
                              lineHeight: 24,
                            }}
                          >
                            {cleanBody}
                          </Text>
                        </View>

                        <Text
                          style={{
                            color: colors.mutedText,
                            fontSize: 11,
                            marginTop: 6,
                            paddingHorizontal: 4,
                          }}
                        >
                          {formatMessageTimestamp(message.created_at)}
                        </Text>
                      </View>
                    </View>
                  );
                })
              ) : (
                <View style={{ flex: 1, justifyContent: "center", paddingVertical: 40 }}>
                  <View style={{ alignItems: "center" }}>
                    <View
                      style={{
                        maxWidth: "88%",
                        borderRadius: 18,
                        backgroundColor: threadSystemBubbleColor,
                        paddingHorizontal: 16,
                        paddingVertical: 14,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 16,
                          fontWeight: "800",
                          textAlign: "center",
                        }}
                      >
                        No texts yet
                      </Text>
                      <Text
                        style={{
                          color: colors.mutedText,
                          lineHeight: 22,
                          marginTop: 8,
                          textAlign: "center",
                        }}
                      >
                        This client does not have an SMS thread yet. Write a message
                        below and press Send when you&apos;re ready.
                      </Text>
                    </View>
                  </View>
                </View>
              )}
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: polishedBorder,
                backgroundColor: composerSurface,
                paddingHorizontal: 12,
                paddingTop: 10,
                paddingBottom: conversationThreadLayout.composerPaddingBottom,
              }}
            >
              {selectedMessage?.channel === "email" ? (
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
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
                          minHeight: 36,
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
              ) : null}

              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 18,
                  marginBottom: 10,
                  fontSize: 12,
                }}
              >
                {replyChannel === "email"
                  ? "Email replies go to your normal email inbox."
                  : smsBalance.loading
                    ? "Text uses 1 SMS credit. Loading balance..."
                    : `Text uses 1 SMS credit. Balance: ${smsBalance.balance.balance}`}
              </Text>

              {replyChannel === "sms" && selectedClientTextIssue ? (
                <View style={{ marginBottom: 10, gap: 8 }}>
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
                <View style={{ marginBottom: 10, gap: 8 }}>
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
                    minHeight: 46,
                    borderWidth: 1,
                    borderColor: polishedBorder,
                    borderRadius: 18,
                    paddingHorizontal: 14,
                    color: colors.text,
                    backgroundColor: threadSurface,
                    marginBottom: 10,
                  }}
                />
              ) : null}

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: 10,
                }}
              >
                <TextInput
                  value={replyBody}
                  onChangeText={setReplyBody}
                  placeholder={
                    replyChannel === "email"
                      ? "Write an email message..."
                      : "Write a text message"
                  }
                  placeholderTextColor={colors.mutedText}
                  multiline
                  textAlignVertical="top"
                  style={{
                    flex: 1,
                    minHeight: 48,
                    maxHeight: 120,
                    borderWidth: 1,
                    borderColor: polishedBorder,
                    borderRadius: 22,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: colors.text,
                    backgroundColor: threadSurface,
                  }}
                />
                <AppButton
                  title={
                    sendingReply
                      ? "Sending..."
                      : replyChannel === "email"
                        ? "Send Email"
                        : "Send"
                  }
                  loading={sendingReply}
                  disabled={sendingReply}
                  fullWidth={false}
                  style={{ minWidth: 108, minHeight: 48 }}
                  onPress={() => {
                    void sendReply();
                  }}
                />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={conversationMenuVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => hideConversationMenu()}
      >
        <View
          style={{
            flex: 1,
            justifyContent: "flex-end",
            paddingHorizontal: 12,
            paddingBottom: conversationThreadLayout.menuPaddingBottom,
          }}
        >
          <Animated.View
            pointerEvents="none"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: conversationMenuOverlayColor,
              opacity: conversationMenuOverlayOpacity,
            }}
          />

          <Pressable style={{ flex: 1 }} onPress={() => hideConversationMenu()} />

          <Animated.View
            {...conversationMenuPanResponder.panHandlers}
            style={{
              transform: [{ translateY: conversationMenuTranslateY }],
              borderRadius: 28,
              borderWidth: 1,
              borderColor: conversationMenuBorder,
              backgroundColor: conversationMenuSurface,
              overflow: "hidden",
              shadowColor: "#000000",
              shadowOpacity: 0.28,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 18,
            }}
          >
            <View
              style={{
                paddingTop: 10,
                paddingHorizontal: 20,
                paddingBottom: 18,
                borderBottomWidth: 1,
                borderBottomColor: "rgba(148, 163, 184, 0.16)",
              }}
            >
              <View
                style={{
                  alignSelf: "center",
                  width: 44,
                  height: 5,
                  borderRadius: 999,
                  backgroundColor: "rgba(226, 232, 240, 0.24)",
                  marginBottom: 16,
                }}
              />
              <Text
                style={{
                  color: "#F8FAFC",
                  fontSize: 20,
                  fontWeight: "900",
                }}
              >
                Conversation Options
              </Text>
              <Text
                style={{
                  color: "rgba(226, 232, 240, 0.72)",
                  fontSize: 14,
                  lineHeight: 20,
                  marginTop: 6,
                }}
                numberOfLines={2}
              >
                {selectedThreadTitle}
                {selectedThreadContact ? ` • ${selectedThreadContact}` : ""}
              </Text>
            </View>

            <View style={{ paddingHorizontal: 14, paddingTop: 8 }}>
              {conversationMenuActions.map((action) => (
                <Pressable
                  key={action.key}
                  accessibilityRole="button"
                  disabled={action.disabled}
                  onPress={() => {
                    if (action.disabled) return;
                    hideConversationMenu(action.onPress);
                  }}
                  style={{
                    borderRadius: 20,
                    paddingHorizontal: 16,
                    paddingVertical: 16,
                    marginTop: 8,
                    backgroundColor: action.disabled
                      ? "rgba(15, 23, 42, 0.38)"
                      : "rgba(15, 118, 110, 0.10)",
                    borderWidth: 1,
                    borderColor: action.disabled
                      ? "rgba(148, 163, 184, 0.14)"
                      : "rgba(45, 212, 191, 0.22)",
                    opacity: action.disabled ? 0.55 : 1,
                  }}
                >
                  <Text
                    style={{
                      color: action.disabled ? "rgba(226, 232, 240, 0.72)" : "#F8FAFC",
                      fontSize: 16,
                      fontWeight: "800",
                    }}
                  >
                    {action.label}
                  </Text>
                  <Text
                    style={{
                      color: action.disabled
                        ? "rgba(148, 163, 184, 0.84)"
                        : "rgba(203, 213, 225, 0.88)",
                      lineHeight: 20,
                      marginTop: 4,
                    }}
                  >
                    {action.description}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View
              style={{
                paddingHorizontal: 14,
                paddingTop: 14,
                paddingBottom: 14,
              }}
            >
              <Pressable
                accessibilityRole="button"
                onPress={() => hideConversationMenu()}
                style={{
                  minHeight: 52,
                  borderRadius: 18,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(15, 118, 110, 0.16)",
                  borderWidth: 1,
                  borderColor: "rgba(45, 212, 191, 0.18)",
                }}
              >
                <Text
                  style={{
                    color: "#5EEAD4",
                    fontSize: 16,
                    fontWeight: "900",
                  }}
                >
                  Close
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        </View>
      </Modal>
    </AppScreen>
  );
}
