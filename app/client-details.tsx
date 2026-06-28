import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from "react-native";

import {
  AndroidTabletSmsFallbackSheet,
  type AndroidTabletSmsFallback,
} from "../components/AndroidTabletSmsFallbackSheet";
import {
  AppButton,
  AppCard,
  AppScreen,
  EmptyState,
  MetricCard,
  ProGateCard,
  ScreenHeader,
  StatusBadge,
  createSchedovaUiTheme,
} from "../components/ui";
import {
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { normalizeClientTag } from "../lib/clientTags";
import { copyTextToClipboard } from "../lib/clipboard";
import {
  canUseFeature,
  FREE_TIER_LIMITS,
  useFeatureAccess,
} from "../lib/featureAccess";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import {
  BUILT_IN_MESSAGE_TEMPLATES,
  fetchCustomMessageTemplates,
  renderMessageTemplate,
  type MessageTemplate,
} from "../lib/messageTemplates";
import {
  openSchedovaProScreen,
  PRO_UPSELL_COPY,
  showProUpgradePrompt,
} from "../lib/proUpsell";
import { buildSchedovaBookingLink } from "../lib/schedovaLinks";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const ANDROID_TABLET_MIN_SHORT_SIDE = 600;

function isAndroidTablet() {
  if (Platform.OS !== "android") return false;

  const { width, height } = Dimensions.get("screen");
  return Math.min(width, height) >= ANDROID_TABLET_MIN_SHORT_SIDE;
}

type ClientRecord = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  birthday?: string | null;
  notes?: string | null;
  client_tag?: string | null;
  sms_opt_in?: boolean | null;
  rebooking_weeks?: number | null;
  no_show_count?: number | null;
};

type AppointmentRecord = {
  id: string;
  client_id?: string | null;
  client_name?: string | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
  start_time?: string | null;
  startTime?: string | null;
  starts_at?: string | null;
  date?: string | null;
  end_time?: string | null;
  status?: string | null;
  final_price?: number | string | null;
  tip_amount?: number | string | null;
  service_id?: string | null;
  service_ids?: string[] | null;
  service_snapshots?: {
    id?: string | null;
    name?: string | null;
    price?: number | string | null;
  }[] | null;
};

type ServiceRecord = {
  id: string;
  name: string | null;
  price?: number | string | null;
};

function formatDate(value?: string | null) {
  if (!value) {
    return "Date not set";
  }

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value?: string | null) {
  if (!value) {
    return "Time not set";
  }

  const [hoursText, minutesText = "00"] = value.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return value;
  }

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatMoney(value: number) {
  return `$${value.toFixed(2)}`;
}

function readNumber(value: number | string | null | undefined) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function getAppointmentStartTime(
  appointment: AppointmentRecord | null | undefined,
) {
  if (!appointment) {
    return null;
  }

  const startTime =
    appointment?.start_time ||
    appointment?.appointment_time ||
    appointment?.startTime ||
    appointment?.starts_at ||
    appointment?.date ||
    null;

  return typeof startTime === "string" && startTime.trim().length > 0
    ? startTime
    : null;
}

function hasAppointmentStartTime(appointment: AppointmentRecord | null | undefined) {
  return getAppointmentStartTime(appointment) !== null;
}

function normalizeAppointments(
  appointmentList: (AppointmentRecord | null | undefined)[] | null | undefined,
) {
  return (appointmentList ?? []).filter(
    (appointment): appointment is AppointmentRecord => Boolean(appointment),
  );
}

function normalizePhoneNumber(phone?: string | null) {
  if (!phone) return "";

  const trimmed = String(phone).trim();
  if (!trimmed) return "";

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");

  if (!digits) return "";

  return hasPlus ? `+${digits}` : digits;
}

function getClientPhone(clientRecord: any, appointment?: any) {
  return (
    clientRecord?.phone ||
    clientRecord?.phone_number ||
    clientRecord?.phoneNumber ||
    appointment?.client_phone ||
    appointment?.clients?.phone ||
    appointment?.clients?.phone_number ||
    ""
  );
}

function getTemplateBody(template: any) {
  return template?.body || template?.message || template?.content || "";
}

function buildSmsUrls(phone: string, message: string) {
  const encodedBody = encodeURIComponent(message || "");

  if (Platform.OS === "android") {
    return [
      `smsto:${phone}?body=${encodedBody}`,
      `sms:${phone}?body=${encodedBody}`,
      `sms:${phone};?body=${encodedBody}`,
    ];
  }

  return [
    `sms:${phone}&body=${encodedBody}`,
    `sms:${phone}?body=${encodedBody}`,
  ];
}

async function openSmsComposer(
  rawPhone: string | null | undefined,
  message: string | null | undefined,
  options: { logSend?: boolean } = {},
) {
  const phone = normalizePhoneNumber(rawPhone);
  const messageBody = String(message || "").trim();

  if (options.logSend !== false) {
    console.log("SMS template send", { rawPhone, messageBody });
  }

  if (!phone) {
    Alert.alert(
      "Missing phone number",
      "Add a phone number for this client before sending a message.",
    );
    return;
  }

  if (!messageBody) {
    Alert.alert(
      "Missing message",
      "Choose or create a message template before sending.",
    );
    return;
  }

  const urls = buildSmsUrls(phone, messageBody);
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const canOpen = await Linking.canOpenURL(url);

      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  console.log("Failed to open SMS composer", {
    phone,
    messageBody,
    urls,
    lastError,
  });

  Alert.alert(
    "Cannot open messages",
    "No messaging app is available, or this device does not support prefilled SMS messages.",
  );
}

function prepareAndroidTabletSmsFallback(
  rawPhone: string | null | undefined,
  message: string | null | undefined,
): AndroidTabletSmsFallback | null {
  const phone = normalizePhoneNumber(rawPhone);
  const messageBody = String(message || "").trim();

  console.log("SMS template send", { rawPhone, messageBody });

  if (!phone) {
    Alert.alert(
      "Missing phone number",
      "Add a phone number for this client before sending a message.",
    );
    return null;
  }

  if (!messageBody) {
    Alert.alert(
      "Missing message",
      "Choose or create a message template before sending.",
    );
    return null;
  }

  const clientPhone = String(rawPhone || phone).trim();

  return {
    rawPhone: clientPhone,
    messageBody,
    fallbackText: messageBody,
  };
}

function getAppointmentStatus(appointment: AppointmentRecord) {
  return appointment.status ?? "scheduled";
}

function InfoLine({
  label,
  value,
  muted = false,
  singleLine = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
  singleLine?: boolean;
}) {
  const { colors } = useAppTheme();
  const theme = createSchedovaUiTheme(colors);

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderTopColor: theme.colors.border,
        paddingVertical: theme.spacing.sm,
      }}
    >
      <Text
        style={{
          color: theme.colors.mutedText,
          fontSize: theme.typography.sizes.caption,
          fontWeight: theme.typography.weights.semibold,
          marginBottom: 3,
        }}
      >
        {label}
      </Text>
      <Text
        numberOfLines={singleLine ? 1 : undefined}
        ellipsizeMode={singleLine ? "tail" : undefined}
        style={{
          color: muted ? theme.colors.mutedText : theme.colors.text,
          fontSize: theme.typography.sizes.body,
          fontWeight: theme.typography.weights.medium,
          maxWidth: "100%",
        }}
      >
        {value}
      </Text>
    </View>
  );
}

export default function ClientDetailsScreen() {
  const params = useLocalSearchParams<{ clientId?: string; id?: string }>();
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const theme = createSchedovaUiTheme(colors);
  useFeatureAccess();
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const polishedCardStyle = {
    borderColor: polishedBorder,
    borderLeftColor: infoAccent,
    borderLeftWidth: 4,
    borderWidth: 1,
  };

  const [client, setClient] = useState<ClientRecord | null>(null);
  const [appointments, setAppointments] = useState<AppointmentRecord[]>([]);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [businessName, setBusinessName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messageModalVisible, setMessageModalVisible] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    BUILT_IN_MESSAGE_TEMPLATES,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    BUILT_IN_MESSAGE_TEMPLATES[0]?.id ?? "",
  );
  const [messageTemplatesLoading, setMessageTemplatesLoading] = useState(false);
  const [androidTabletSmsFallback, setAndroidTabletSmsFallback] =
    useState<AndroidTabletSmsFallback | null>(null);

  const clientIdValue = params.clientId ?? params.id ?? null;

  const fetchData = useCallback(async () => {
    if (!clientIdValue) {
      setLoading(false);
      setError("Client could not be loaded.");
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("Please sign in to view this client.");
        return;
      }

      const { data: clientData, error: clientError } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientIdValue)
        .eq("user_id", user.id)
        .single();

      if (clientError) {
        throw clientError;
      }

      const { data: appointmentData, error: appointmentError } = await supabase
        .from("appointments")
        .select("*")
        .eq("user_id", user.id)
        .order("appointment_date", { ascending: false });

      if (appointmentError) {
        throw appointmentError;
      }

      const { data: serviceData, error: serviceError } = await supabase
        .from("services")
        .select("*")
        .eq("user_id", user.id);

      if (serviceError) {
        throw serviceError;
      }

      const { data: businessData } = await supabase
        .from("businesses")
        .select("business_name")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();

      const normalizedAppointments = normalizeAppointments(
        appointmentData as (AppointmentRecord | null | undefined)[] | null,
      );
      const filteredAppointments = normalizedAppointments.filter(
        (appointment: AppointmentRecord) =>
          appointment.client_id === clientIdValue ||
          appointment.client_name === clientData?.name,
      );

      setClient(clientData as ClientRecord);
      setAppointments(filteredAppointments as AppointmentRecord[]);
      setServices((serviceData ?? []) as ServiceRecord[]);
      setBusinessName(
        typeof businessData?.business_name === "string"
          ? businessData.business_name
          : "",
      );
    } catch (fetchError) {
      console.error("Failed to load client details:", fetchError);
      setError("Unable to load client details. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [clientIdValue]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const clientAppointments = useMemo(
    () => normalizeAppointments(appointments),
    [appointments],
  );

  const getSuggestedRebookDate = () => {
    const completedAppointments = clientAppointments
      .filter(
        (appointment) =>
          getAppointmentStatus(appointment) === "completed" &&
          appointment.appointment_date,
      )
      .sort((a, b) =>
        String(b.appointment_date).localeCompare(String(a.appointment_date)),
      );

    if (completedAppointments.length === 0) {
      return null;
    }

    const lastDate = new Date(
      `${completedAppointments[0].appointment_date}T00:00:00`,
    );
    const rebookingWeeks = client?.rebooking_weeks ?? 6;
    lastDate.setDate(lastDate.getDate() + rebookingWeeks * 7);

    return lastDate.toISOString().slice(0, 10);
  };

  const getDisplayPrice = (appointment: AppointmentRecord) => {
    const finalPrice = readNumber(appointment.final_price);
    if (finalPrice > 0) {
      return finalPrice;
    }

    return getAppointmentServiceTotal(appointment, services);
  };

  const smartRemindersAvailable = canUseFeature("smartReminders");
  const noShowTrackerAvailable = canUseFeature("noShowTracker");
  const revenueAvailable = canUseFeature("revenueInsights");
  const fullHistoryAvailable = canUseFeature("fullClientHistory");

  const completedAppointments = clientAppointments.filter(
    (appointment) => getAppointmentStatus(appointment) === "completed",
  );
  const noShows = clientAppointments.filter(
    (appointment) => getAppointmentStatus(appointment) === "no_show",
  );
  const totalSpent = completedAppointments.reduce(
    (sum, appointment) => sum + getDisplayPrice(appointment),
    0,
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const pastAppointments = clientAppointments.filter((appointment) => {
    const status = getAppointmentStatus(appointment);
    return (
      (appointment.appointment_date ?? "") < todayIso ||
      status === "completed" ||
      status === "canceled" ||
      status === "cancelled" ||
      status === "no_show"
    );
  });
  const visiblePastAppointments = fullHistoryAvailable
    ? pastAppointments
    : pastAppointments.slice(0, FREE_TIER_LIMITS.clientHistoryItems);
  const lockedPastAppointmentCount = Math.max(
    0,
    pastAppointments.length - visiblePastAppointments.length,
  );

  const clientName = client?.name?.trim() || "Client";
  const normalizedTag = normalizeClientTag(client?.client_tag);
  const clientEmail = client?.email?.trim() || "";
  const headerSubtitle =
    [client?.phone, client?.client_tag ? normalizedTag : null]
      .filter(Boolean)
      .join(" | ") || (clientEmail ? undefined : "Client details");
  const suggestedRebookDate = getSuggestedRebookDate();

  const openEditClient = () => {
    if (!clientIdValue) {
      return;
    }

    router.push({ pathname: "/edit-client", params: { clientId: clientIdValue } });
  };

  const openBookAppointment = () => {
    router.push({
      pathname: "/book-appointment",
      params: {
        clientId: clientIdValue ?? "",
        clientName,
      },
    } as never);
  };

  const openAppointment = (appointmentId: string) => {
    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentId,
        mode: "edit",
      },
    } as never);
  };

  const messageAppointment = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sortedAppointments = clientAppointments
      .filter(hasAppointmentStartTime)
      .sort((first, second) => {
        const firstDate = `${first.appointment_date || ""} ${getAppointmentStartTime(first) || ""}`;
        const secondDate = `${second.appointment_date || ""} ${getAppointmentStartTime(second) || ""}`;
        return firstDate.localeCompare(secondDate);
      });

    return (
      sortedAppointments.find(
        (appointment) => (appointment.appointment_date || "") >= today,
      ) ||
      sortedAppointments[sortedAppointments.length - 1] ||
      null
    );
  }, [clientAppointments]);

  const selectedTemplate =
    messageTemplates.find((template) => template.id === selectedTemplateId) ||
    messageTemplates[0] ||
    null;

  const messageTemplateValues = useMemo(() => {
    const appointmentServices = messageAppointment
      ? getAppointmentServices(messageAppointment, services)
      : [];
    const serviceNames = appointmentServices
      .map((service) => service.name)
      .filter(Boolean)
      .join(", ");
    const appointmentTime = messageAppointment
      ? getAppointmentStartTime(messageAppointment)
      : null;
    const addToSchedovaLink =
      messageAppointment?.appointment_date && appointmentTime
        ? buildSchedovaBookingLink({
            clientId: clientIdValue,
            date: messageAppointment.appointment_date,
            time: appointmentTime.slice(0, 5),
            serviceId: appointmentServices[0]?.id,
            source: "message",
          })
        : null;

    return {
      client_name: clientName,
      appointment_date: messageAppointment?.appointment_date
        ? formatDate(messageAppointment.appointment_date)
        : null,
      appointment_time: messageAppointment
        ? formatTime(appointmentTime)
        : null,
      service_name: serviceNames || null,
      business_name: businessName || "your business",
      add_to_schedova_link: addToSchedovaLink,
    };
  }, [businessName, clientIdValue, clientName, messageAppointment, services]);

  const renderedMessage = selectedTemplate
    ? renderMessageTemplate(getTemplateBody(selectedTemplate), messageTemplateValues)
    : "";

  async function openMessageClient() {
    if (!canUseFeature("unlimitedMessageTemplates")) {
      showProUpgradePrompt(PRO_UPSELL_COPY.messageTemplates);
      return;
    }

    setMessageModalVisible(true);

    if (messageTemplates.length > BUILT_IN_MESSAGE_TEMPLATES.length) {
      return;
    }

    setMessageTemplatesLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const customTemplates = await fetchCustomMessageTemplates(user.id);
      const nextTemplates = [
        ...BUILT_IN_MESSAGE_TEMPLATES,
        ...customTemplates,
      ];

      setMessageTemplates(nextTemplates);
      setSelectedTemplateId(
        (currentId) => currentId || nextTemplates[0]?.id || "",
      );
    } catch (templateError) {
      console.log("CLIENT MESSAGE TEMPLATE LOAD ERROR:", templateError);
      setMessageTemplates(BUILT_IN_MESSAGE_TEMPLATES);
    } finally {
      setMessageTemplatesLoading(false);
    }
  }

  async function copySelectedMessage() {
    if (!renderedMessage) return;

    try {
      await copyTextToClipboard(renderedMessage);
    } catch (error) {
      console.error("Clipboard copy failed:", error);
      Alert.alert("Copy failed", "Unable to copy message. Please try again.");
    }
  }

  async function openSmsUrl(phoneNumber: string, logSend = true) {
    await openSmsComposer(phoneNumber, renderedMessage, { logSend });
  }

  async function openSmsWithTabletFallback(phoneNumber: string) {
    if (isAndroidTablet()) {
      const fallback = prepareAndroidTabletSmsFallback(
        phoneNumber,
        renderedMessage,
      );

      if (fallback) {
        setAndroidTabletSmsFallback(fallback);
      }

      return;
    }

    await openSmsUrl(phoneNumber);
  }

  async function copyAndroidTabletSmsFallback() {
    if (!androidTabletSmsFallback) return;

    try {
      await copyTextToClipboard(androidTabletSmsFallback.fallbackText);
      setAndroidTabletSmsFallback(null);
    } catch (copyError) {
      console.log("SMS fallback copy failed", copyError);
      Alert.alert("Copy failed", "Unable to copy message.");
    }
  }

  async function shareAndroidTabletSmsFallback() {
    if (!androidTabletSmsFallback) return;

    try {
      await Share.share({ message: androidTabletSmsFallback.fallbackText });
      setAndroidTabletSmsFallback(null);
    } catch (shareError) {
      console.log("SMS fallback share failed", shareError);
    }
  }

  async function openAndroidTabletMessagesAnyway() {
    const fallback = androidTabletSmsFallback;
    setAndroidTabletSmsFallback(null);

    if (!fallback) return;

    await openSmsComposer(fallback.rawPhone, fallback.messageBody, {
      logSend: false,
    });
  }

  async function openSmsApp() {
    const phoneNumber = getClientPhone(client, messageAppointment);

    if (!normalizePhoneNumber(phoneNumber)) {
      Alert.alert(
        "Missing phone number",
        "Add a phone number for this client before sending a message.",
      );
      return;
    }

    if (!client?.sms_opt_in) {
      Alert.alert(
        "SMS opt-in required",
        "This client has not opted in to appointment texts.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open SMS App",
            onPress: () => {
              void openSmsWithTabletFallback(phoneNumber);
            },
          },
        ],
      );
      return;
    }

    await openSmsWithTabletFallback(phoneNumber);
  }

  if (loading) {
    return (
      <AppScreen scroll backgroundColor={colors.background}>
        <ScreenHeader title="Client details" subtitle="Loading client..." />
      </AppScreen>
    );
  }

  if (error) {
    return (
      <AppScreen scroll backgroundColor={colors.background}>
        <ScreenHeader title="Client details" subtitle="Something went wrong." />
        <EmptyState
          title="Unable to load client"
          message={error}
          actionLabel="Try Again"
          onAction={fetchData}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <ScreenHeader
        title={clientName}
        subtitle={headerSubtitle}
        style={{ marginBottom: clientEmail ? theme.spacing.sm : theme.spacing["2xl"] }}
      />
      {clientEmail ? (
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{
            color: theme.colors.mutedText,
            fontSize: theme.typography.sizes.bodyLarge,
            lineHeight: theme.typography.lineHeights.subtitle,
            marginBottom: theme.spacing["2xl"],
            maxWidth: "100%",
          }}
        >
          {clientEmail}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.lg,
        }}
      >
        <AppButton
          title="Edit Client"
          onPress={openEditClient}
          fullWidth={false}
          style={{ flexGrow: 1, flexBasis: 150 }}
        />
        <AppButton
          title="Book Appointment"
          onPress={openBookAppointment}
          fullWidth={false}
          style={{ flexGrow: 1, flexBasis: 150 }}
        />
        <AppButton
          title="Message Client"
          variant="secondary"
          onPress={() => {
            void openMessageClient();
          }}
          fullWidth={false}
          style={{ flexGrow: 1, flexBasis: 150 }}
        />
      </View>

      <AppCard style={[polishedCardStyle, { marginBottom: theme.spacing.lg }]}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.sizes.cardTitle,
            fontWeight: theme.typography.weights.bold,
            marginBottom: theme.spacing.sm,
          }}
        >
          Contact
        </Text>
        <View
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            backgroundColor: infoAccent,
            marginBottom: theme.spacing.sm,
          }}
        />
        <InfoLine label="Phone" value={client?.phone || "Not set"} muted={!client?.phone} />
        <InfoLine
          label="Email"
          value={client?.email || "Not set"}
          muted={!client?.email}
          singleLine
        />
        <InfoLine
          label="Birthday"
          value={client?.birthday ? formatDate(client.birthday) : "Not set"}
          muted={!client?.birthday}
        />
        <InfoLine label="Tag" value={normalizedTag} />
        <InfoLine
          label="SMS opt-in"
          value={
            client?.sms_opt_in
              ? "Agreed to appointment texts"
              : "Not opted in for appointment texts"
          }
        />
      </AppCard>

      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: theme.spacing.sm,
          marginBottom: theme.spacing.lg,
        }}
      >
        <MetricCard
          label="Appointments"
          value={clientAppointments.length}
          helper="Total visits"
          style={{
            borderColor: infoAccentBorder,
            borderTopColor: infoAccent,
            borderTopWidth: 3,
            flex: 1,
            minWidth: 150,
          }}
        />
        <MetricCard
          label="Completed"
          value={completedAppointments.length}
          helper="Finished visits"
          style={{
            borderColor: infoAccentBorder,
            borderTopColor: infoAccent,
            borderTopWidth: 3,
            flex: 1,
            minWidth: 150,
          }}
        />
        {ENABLE_PRO ? (
          <MetricCard
            label="Client value"
            value={revenueAvailable ? formatMoney(totalSpent) : "Pro"}
            helper={
              revenueAvailable
                ? "Completed appointment total"
                : "Revenue insights"
            }
            style={{
              borderColor: infoAccentBorder,
              borderTopColor: infoAccent,
              borderTopWidth: 3,
              flex: 1,
              minWidth: 150,
            }}
          />
        ) : null}
        {ENABLE_PRO ? (
          <MetricCard
            label="No-shows"
            value={
              noShowTrackerAvailable
                ? client?.no_show_count ?? noShows.length
                : "Pro"
            }
            helper={
              noShowTrackerAvailable ? "Tracked visits" : "No-show tracker"
            }
            style={{
              borderColor: infoAccentBorder,
              borderTopColor: infoAccent,
              borderTopWidth: 3,
              flex: 1,
              minWidth: 150,
            }}
          />
        ) : null}
      </View>

      <AppCard style={[polishedCardStyle, { marginBottom: theme.spacing.lg }]}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.sizes.cardTitle,
            fontWeight: theme.typography.weights.bold,
            marginBottom: theme.spacing.sm,
          }}
        >
          Notes
        </Text>
        <View
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            backgroundColor: infoAccent,
            marginBottom: theme.spacing.sm,
          }}
        />
        <Text
          style={{
            color: client?.notes ? theme.colors.text : theme.colors.mutedText,
            fontSize: theme.typography.sizes.body,
            lineHeight: 22,
          }}
        >
          {client?.notes || "No notes yet."}
        </Text>
      </AppCard>

      <AppCard style={[polishedCardStyle, { marginBottom: theme.spacing.lg }]}>
        <Text
          style={{
            color: theme.colors.text,
            fontSize: theme.typography.sizes.cardTitle,
            fontWeight: theme.typography.weights.bold,
            marginBottom: theme.spacing.sm,
          }}
        >
          Client insights
        </Text>
        <View
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            backgroundColor: infoAccent,
            marginBottom: theme.spacing.sm,
          }}
        />
        <InfoLine
          label="Rebooking cadence"
          value={`${client?.rebooking_weeks ?? 6} weeks`}
        />
        {ENABLE_PRO ? (
          <InfoLine
            label="Suggested rebook"
            value={
              smartRemindersAvailable && suggestedRebookDate
                ? formatDate(suggestedRebookDate)
                : smartRemindersAvailable
                  ? "Book a completed visit to calculate this."
                  : "Included with Schedova Pro."
            }
            muted={!smartRemindersAvailable || !suggestedRebookDate}
          />
        ) : null}
      </AppCard>

      <View style={{ marginBottom: theme.spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: theme.spacing.sm,
            marginBottom: theme.spacing.xs,
          }}
        >
          <View
            style={{
              width: 4,
              height: 20,
              borderRadius: 999,
              backgroundColor: infoAccent,
            }}
          />
          <Text
            style={{
              color: theme.colors.text,
              fontSize: theme.typography.sizes.section,
              fontWeight: theme.typography.weights.bold,
            }}
          >
            Appointment history
          </Text>
        </View>
        <Text
          style={{
            color: theme.colors.mutedText,
            fontSize: theme.typography.sizes.body,
          }}
        >
          Past appointments, services, status, and value.
        </Text>
      </View>

      {pastAppointments.length === 0 ? (
        <EmptyState
          title="No appointment history yet"
          message="Book this client to start building their history."
          actionLabel="Book Appointment"
          onAction={openBookAppointment}
        />
      ) : (
        <View style={{ gap: theme.spacing.sm }}>
          {normalizeAppointments(visiblePastAppointments).map((appointment) => {
            const appointmentServices = getAppointmentServices(appointment, services);
            const serviceNames =
              appointmentServices.length > 0
                ? appointmentServices.map((service) => service.name).join(", ")
                : "Service not set";
            const status = getAppointmentStatus(appointment);
            const price = getDisplayPrice(appointment);

            return (
              <AppCard
                key={appointment.id}
                onPress={() => openAppointment(appointment.id)}
                style={[
                  polishedCardStyle,
                  {
                    backgroundColor: theme.colors.card,
                    paddingVertical: theme.spacing.md,
                  },
                ]}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: theme.spacing.sm,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: theme.colors.text,
                        fontSize: theme.typography.sizes.body,
                        fontWeight: theme.typography.weights.bold,
                      }}
                    >
                      {formatDate(appointment.appointment_date)}
                    </Text>
                    <Text
                      style={{
                        color: theme.colors.mutedText,
                        fontSize: theme.typography.sizes.caption,
                        marginTop: 2,
                      }}
                    >
                      {formatTime(getAppointmentStartTime(appointment))}
                      {appointment.end_time ? ` - ${formatTime(appointment.end_time)}` : ""}
                    </Text>
                  </View>
                  <StatusBadge
                    status={status}
                    style={
                      status === "scheduled"
                        ? {
                            backgroundColor: infoAccent,
                            borderColor: infoAccent,
                          }
                        : undefined
                    }
                    textStyle={status === "scheduled" ? { color: "#FFFFFF" } : undefined}
                  />
                </View>

                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.body,
                    fontWeight: theme.typography.weights.medium,
                    marginBottom: 4,
                  }}
                >
                  {serviceNames}
                </Text>
                <Text
                  style={{
                    color: infoAccent,
                    fontSize: theme.typography.sizes.caption,
                    fontWeight: theme.typography.weights.bold,
                  }}
                >
                  {price > 0 ? formatMoney(price) : "No price recorded"}
                </Text>
              </AppCard>
            );
          })}
        </View>
      )}

      {ENABLE_PRO && lockedPastAppointmentCount > 0 ? (
        <ProGateCard
          title="Client history is included with Schedova Pro."
          message="See past appointments, services, and notes as your client list grows."
          features={[
            `${lockedPastAppointmentCount} more appointment${
              lockedPastAppointmentCount === 1 ? "" : "s"
            } hidden on Free.`,
          ]}
          ctaLabel="Upgrade to Schedova Pro"
          onPress={openSchedovaProScreen}
          style={{ marginTop: theme.spacing.lg }}
        />
      ) : null}

      <Modal
        visible={messageModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMessageModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.58)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: theme.colors.background,
              borderTopLeftRadius: theme.radii["2xl"],
              borderTopRightRadius: theme.radii["2xl"],
              borderWidth: 1,
              borderColor: theme.colors.border,
              maxHeight: "88%",
              padding: theme.spacing.lg,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: theme.spacing.md,
                marginBottom: theme.spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontSize: theme.typography.sizes.section,
                    fontWeight: theme.typography.weights.heavy,
                  }}
                >
                  Message Client
                </Text>
                <Text
                  style={{
                    color: theme.colors.mutedText,
                    lineHeight: theme.typography.lineHeights.body,
                    marginTop: theme.spacing.xs,
                  }}
                >
                  Pick a template, preview it, then copy it or open your SMS app.
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close message client"
                onPress={() => setMessageModalVisible(false)}
                hitSlop={10}
              >
                <Text
                  style={{
                    color: theme.colors.mutedText,
                    fontSize: theme.typography.sizes.section,
                    fontWeight: theme.typography.weights.heavy,
                  }}
                >
                  X
                </Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <AppCard style={{ marginBottom: theme.spacing.md }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontWeight: theme.typography.weights.heavy,
                    marginBottom: theme.spacing.xs,
                  }}
                >
                  SMS opt-in
                </Text>
                <Text
                  style={{
                    color: client?.sms_opt_in
                      ? theme.colors.mutedText
                      : theme.colors.warning,
                    lineHeight: theme.typography.lineHeights.body,
                  }}
                >
                  {client?.sms_opt_in
                    ? "Client agreed to appointment texts."
                    : "This client has not opted in to appointment texts."}
                </Text>
              </AppCard>

              <Text
                style={{
                  color: theme.colors.text,
                  fontWeight: theme.typography.weights.heavy,
                  marginBottom: theme.spacing.sm,
                }}
              >
                Templates
              </Text>

              {messageTemplatesLoading ? (
                <AppCard style={{ marginBottom: theme.spacing.md }}>
                  <Text style={{ color: theme.colors.mutedText }}>
                    Loading templates...
                  </Text>
                </AppCard>
              ) : null}

              {!messageTemplatesLoading && messageTemplates.length === 0 ? (
                <EmptyState
                  title="No templates yet"
                  message="Create a template in Settings to reuse messages with clients."
                  actionLabel="Create Template"
                  onAction={() => {
                    setMessageModalVisible(false);
                    router.push("/settings/message-templates" as never);
                  }}
                  style={{ marginBottom: theme.spacing.md }}
                />
              ) : null}

              <View style={{ gap: theme.spacing.sm, marginBottom: theme.spacing.md }}>
                {messageTemplates.map((template) => {
                  const selected = template.id === selectedTemplate?.id;

                  return (
                    <AppCard
                      key={template.id}
                      onPress={() => setSelectedTemplateId(template.id)}
                      style={{
                        borderColor: selected
                          ? theme.colors.primary
                          : theme.colors.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: theme.spacing.md,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: theme.colors.text,
                              fontWeight: theme.typography.weights.heavy,
                            }}
                          >
                            {template.title}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{
                              color: theme.colors.mutedText,
                              lineHeight: theme.typography.lineHeights.helper,
                              marginTop: theme.spacing.xs,
                            }}
                          >
                            {getTemplateBody(template)}
                          </Text>
                        </View>

                        <Text
                          style={{
                            color: selected
                              ? theme.colors.primary
                              : theme.colors.mutedText,
                            fontWeight: theme.typography.weights.heavy,
                          }}
                        >
                          {selected ? "Selected" : "Use"}
                        </Text>
                      </View>
                    </AppCard>
                  );
                })}
              </View>

              <AppCard style={{ marginBottom: theme.spacing.md }}>
                <Text
                  style={{
                    color: theme.colors.text,
                    fontWeight: theme.typography.weights.heavy,
                    marginBottom: theme.spacing.sm,
                  }}
                >
                  Preview
                </Text>
                <Text
                  style={{
                    color: theme.colors.text,
                    lineHeight: theme.typography.lineHeights.body,
                  }}
                >
                  {renderedMessage || "Select a template to preview it."}
                </Text>
              </AppCard>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: theme.spacing.sm,
                  paddingBottom: theme.spacing.md,
                }}
              >
                <AppButton
                  title="Copy Message"
                  onPress={() => {
                    void copySelectedMessage();
                  }}
                  fullWidth={false}
                  style={{ flexGrow: 1, flexBasis: 150 }}
                />
                <AppButton
                  title="Open SMS App"
                  variant="secondary"
                  onPress={() => {
                    void openSmsApp();
                  }}
                  fullWidth={false}
                  style={{ flexGrow: 1, flexBasis: 150 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AndroidTabletSmsFallbackSheet
        visible={Boolean(androidTabletSmsFallback)}
        onCancel={() => setAndroidTabletSmsFallback(null)}
        onCopy={() => {
          void copyAndroidTabletSmsFallback();
        }}
        onOpenMessages={() => {
          void openAndroidTabletMessagesAnyway();
        }}
        onShare={() => {
          void shareAndroidTabletSmsFallback();
        }}
      />
    </AppScreen>
  );
}
