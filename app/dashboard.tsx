import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  EmptyState,
  ScreenHeader,
  StatusBadge,
} from "../components/ui";
import {
  getAppointmentServices as getSavedAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import {
  getAppointmentConfirmationLabel,
  getAppointmentConfirmationStatus,
  type AppointmentReplySummary,
} from "../lib/appointmentConfirmationStatus";
import { useAuthSession } from "../lib/authSession";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { formatClockTime, getCalendarPreferences } from "../lib/calendarPreferences";
import { subscribeToClientMessageEvents } from "../lib/clientMessageEvents";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { openSchedovaProScreen } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

function normalizeDashboardAppointmentRows(rows: unknown) {
  return Array.isArray(rows)
    ? rows.filter((appointment) => appointment && typeof appointment === "object")
    : [];
}

function isDashboardAppointmentVisible(appointment: any) {
  return Boolean(appointment?.id && appointment?.appointment_date);
}

export default function Dashboard() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const { width } = useWindowDimensions();
  const { isHydrated, user, userId } = useAuthSession();
  useFeatureAccess();
  const [clients, setClients] = useState<any[]>([]);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedStatusAppointment, setSelectedStatusAppointment] = useState<
    any | null
  >(null);
  const [fontScale, setFontScale] = useState("normal");
  const [use24Hour, setUse24Hour] = useState(false);
  const [hasBusiness, setHasBusiness] = useState<boolean | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [userEmail, setUserEmail] = useState("");
  const [clientRepliesCount, setClientRepliesCount] = useState(0);
  const [latestRepliesByAppointmentId, setLatestRepliesByAppointmentId] =
    useState<Record<string, AppointmentReplySummary>>({});

  function canUseProFeature(feature: Parameters<typeof canUseFeature>[0]) {
    return canUseFeature(feature);
  }

  const quickActionCardWidth = width >= 720 ? "31.5%" : "100%";
  const dashboardSummaryAccent =
    themeName === "dark" || themeName === "black" ? "#60A5FA" : "#2563EB";
  const dashboardStatusAccent = "#2563EB";
  const dashboardAccentSoft =
    themeName === "dark" || themeName === "black"
      ? "rgba(96, 165, 250, 0.16)"
      : "rgba(37, 99, 235, 0.10)";
  const dashboardAccentBorder =
    themeName === "dark" || themeName === "black"
      ? "rgba(96, 165, 250, 0.32)"
      : "rgba(37, 99, 235, 0.24)";
  const dashboardGreenSoft =
    themeName === "dark" || themeName === "black"
      ? "rgba(15, 118, 110, 0.28)"
      : "rgba(15, 118, 110, 0.12)";
  const dashboardCardBorder =
    themeName === "dark" || themeName === "black"
      ? "rgba(148, 163, 184, 0.28)"
      : "rgba(15, 23, 42, 0.12)";
  const dashboardCardShadow =
    Platform.OS === "web"
      ? {}
      : {
          shadowColor: "#000000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: themeName === "dark" || themeName === "black" ? 0.28 : 0.08,
          shadowRadius: 12,
          elevation: 2,
        };

  const clientRepliesBadgeText =
    clientRepliesCount > 99 ? "99+" : String(clientRepliesCount);

  function getClientDisplayName(appointment: any) {
    const appointmentName = String(appointment?.client_name || "").trim();

    if (appointmentName && appointmentName !== "New Client") {
      return appointmentName;
    }

    const matchedClient = clients.find(
      (client) => String(client?.id) === String(appointment?.client_id),
    );

    return (
      (String(matchedClient?.name || "").trim() !== "New Client"
        ? String(matchedClient?.name || "").trim()
        : "") ||
      String(matchedClient?.phone || "").trim() ||
      String(matchedClient?.email || "").trim() ||
      "New Client"
    );
  }

  const fetchClients = useCallback(async () => {
    if (!isHydrated) return;

    if (!userId) {
      setClients([]);
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.log("FETCH CLIENTS ERROR:", error.message);
      setClients([]);
      return;
    }

    setClients((data || []).filter(Boolean));
  }, [isHydrated, userId]);

  const loadFontScale = useCallback(async () => {
    const savedFont = await AsyncStorage.getItem("font_scale");
    setFontScale(savedFont || "normal");
  }, []);

  const loadCalendarDisplayPreferences = useCallback(async () => {
    const preferences = await getCalendarPreferences();
    setUse24Hour(preferences.timeFormat === "24h");
  }, []);

  function getFontSize(base: number) {
    if (fontScale === "small") return base - 2;
    if (fontScale === "large") return base + 3;
    return base;
  }

  const checkBusiness = useCallback(async () => {
    if (!isHydrated) return;

    setUserEmail(user?.email || "");

    if (!userId) {
      setHasBusiness(false);
      router.replace("/login" as any);
      return;
    }

    const { data, error } = await supabase
      .from("businesses")
      .select("*")
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      console.log("CHECK BUSINESS ERROR:", error.message);
      setHasBusiness(false);
      return;
    }

    setHasBusiness((data || []).length > 0);
  }, [isHydrated, router, user?.email, userId]);

  const fetchAppointments = useCallback(async () => {
    if (!isHydrated) return;

    setUserEmail(user?.email || "");

    if (!userId) {
      setAppointments([]);
      return;
    }

    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    if (error) {
      console.log("FETCH APPOINTMENTS ERROR:", error.message);
      setAppointments([]);
      setLatestRepliesByAppointmentId({});
      return;
    }

    const nextAppointments = normalizeDashboardAppointmentRows(data);
    setAppointments(nextAppointments);

    const appointmentIds = nextAppointments
      .map((appointment) => appointment?.id)
      .filter(Boolean)
      .map(String);

    if (appointmentIds.length === 0) {
      setLatestRepliesByAppointmentId({});
      return;
    }

    const repliesResult = await supabase
      .from("sms_message_logs")
      .select("id, appointment_id, body, message_body, needs_attention, created_at")
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .in("appointment_id", appointmentIds)
      .order("created_at", { ascending: false });

    if (repliesResult.error) {
      console.log(
        "FETCH APPOINTMENT REPLIES ERROR:",
        repliesResult.error.message,
      );
      setLatestRepliesByAppointmentId({});
      return;
    }

    const nextRepliesByAppointmentId: Record<string, AppointmentReplySummary> =
      {};

    for (const reply of repliesResult.data || []) {
      const appointmentId = String(reply?.appointment_id || "");
      if (!appointmentId || nextRepliesByAppointmentId[appointmentId]) {
        continue;
      }

      nextRepliesByAppointmentId[appointmentId] = reply;
    }

    setLatestRepliesByAppointmentId(nextRepliesByAppointmentId);
  }, [isHydrated, user?.email, userId]);

  const fetchServices = useCallback(async () => {
    if (!isHydrated) return;

    if (!userId) {
      setServices([]);
      return;
    }

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.log("FETCH SERVICES ERROR:", error.message);
      setServices([]);
      return;
    }

    setServices((data || []).filter(Boolean));
  }, [isHydrated, userId]);

  const fetchClientRepliesCount = useCallback(async () => {
    if (!isHydrated) return;

    if (!canUseProFeature("smsAutomation")) {
      setClientRepliesCount(0);
      console.log("Dashboard reply badge count", 0);
      return;
    }

    console.log("Dashboard current user id", userId || null);

    if (!userId) {
      setClientRepliesCount(0);
      console.log("Dashboard reply badge count", 0);
      return;
    }

    const preferredResult = await supabase
      .from("sms_message_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .is("read_at", null)
      .is("resolved_at", null);

    if (!preferredResult.error) {
      const count = preferredResult.count || 0;
      setClientRepliesCount(count);
      console.log("Dashboard reply badge count", count);
      return;
    }

    const fallbackResult = await supabase
      .from("sms_message_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("direction", "inbound")
      .is("resolved_at", null);

    if (fallbackResult.error) {
      console.log(
        "FETCH CLIENT REPLIES COUNT ERROR:",
        fallbackResult.error.message,
      );
      setClientRepliesCount(0);
      console.log("Dashboard reply badge count", 0);
      return;
    }

    const count = fallbackResult.count || 0;
    setClientRepliesCount(count);
    console.log("Dashboard reply badge count", count);
  }, [isHydrated, userId]);

  function openClientReplies() {
    console.log("Dashboard navigation to messages screen");
    router.push("/messages" as any);
  }

  useFocusEffect(
    useCallback(() => {
      void loadFontScale();
      void loadCalendarDisplayPreferences();
      void checkBusiness();
      void fetchAppointments();
      void fetchServices();
      void fetchClients();
      void fetchClientRepliesCount();
    }, [
      checkBusiness,
      fetchAppointments,
      fetchClientRepliesCount,
      fetchClients,
      fetchServices,
      loadCalendarDisplayPreferences,
      loadFontScale,
    ]),
  );

  useEffect(() => {
    return subscribeToClientMessageEvents(() => {
      void fetchClientRepliesCount();
    });
  }, [fetchClientRepliesCount]);

  async function deleteAppointment(id: string) {
    await confirmDestructiveAction({
      title: "Delete appointment?",
      message: "This appointment will be removed.",
      confirmText: "Delete",
      onConfirm: async () => {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          Alert.alert("Not signed in", "Please sign in again.");
          return;
        }

        if (canUseProFeature("smsAutomation")) {
          await sendAppointmentSmsNonBlocking(id, "cancellation");
        }

        const { error } = await supabase
          .from("appointments")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }

        await cancelAppointmentReminder(id);
        await fetchAppointments();
      },
    });
  }

  async function updateAppointmentStatus(status: string) {
    if (!selectedStatusAppointment?.id) return;

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    const { error } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", selectedStatusAppointment.id)
      .eq("user_id", user.id);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    if (status === "canceled") {
      if (canUseProFeature("smsAutomation")) {
        void sendAppointmentSmsNonBlocking(
          selectedStatusAppointment.id,
          "cancellation",
        );
      }
      await cancelAppointmentReminder(selectedStatusAppointment.id);
    }

    await fetchAppointments();
    setStatusModalOpen(false);
  }

  function getAppointmentServices(appointment: any) {
    return getSavedAppointmentServices(appointment, services);
  }

  function formatDate(dateString?: string | null) {
    if (!dateString) return "";
    const date = new Date(`${dateString}T12:00:00`);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatTime(timeString?: string | null) {
    return formatClockTime(timeString, use24Hour);
  }

  function timeToMinutes(timeString?: string | null) {
    const cleanTime = String(timeString || "").slice(0, 5);
    const [hourText, minuteText] = cleanTime.split(":");
    const hours = Number(hourText);
    const minutes = Number(minuteText);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
      return Number.NaN;
    }

    return hours * 60 + minutes;
  }

  function minutesToTime(minutes: number) {
    const safeMinutes = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(safeMinutes / 60);
    const remainingMinutes = safeMinutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(
      remainingMinutes,
    ).padStart(2, "0")}`;
  }

  function getAppointmentEndTime(appointment: any, durationMinutes: number) {
    const startMinutes = timeToMinutes(appointment?.appointment_time);

    if (Number.isFinite(startMinutes) && durationMinutes > 0) {
      return minutesToTime(startMinutes + durationMinutes);
    }

    return appointment?.end_time ? String(appointment.end_time).slice(0, 5) : "";
  }

  function formatAppointmentTimeRange(appointment: any, durationMinutes: number) {
    const start = formatTime(appointment?.appointment_time) || "Time not set";
    const end = formatTime(getAppointmentEndTime(appointment, durationMinutes));

    return end && start !== "Time not set" ? `${start} - ${end}` : start;
  }

  function openAppointmentEdit(appointment: any) {
    if (!appointment?.id) return;

    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentId: appointment.id,
        mode: "edit",
      },
    } as any);
  }

  const now = new Date();

  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(now.getDate()).padStart(2, "0")}`;

  const displayAppointments = appointments.filter(isDashboardAppointmentVisible);

  const todaysAppointments = displayAppointments.filter(
    (appointment) =>
      appointment?.appointment_date === todayIso &&
      appointment?.status !== "canceled",
  );

  const upcomingAppointments = displayAppointments
    .filter(
      (appointment) =>
        appointment?.appointment_date >= todayIso &&
        appointment?.status !== "canceled",
    )
    .slice(0, 5);
  const todayMetricHelper =
    todaysAppointments.length === 1 ? "Appointment" : "Appointments";
  const upcomingMetricHelper =
    upcomingAppointments.length === 1
      ? "Next appointment"
      : "Next appointments";

  const revenueAvailable =
    ENABLE_PRO && canUseProFeature("revenueInsights");

  const estimatedRevenue = revenueAvailable
    ? todaysAppointments.reduce((total, appointment) => {
        const serviceTotal =
          appointment.final_price !== null &&
          appointment.final_price !== undefined
            ? Number(appointment.final_price || 0)
            : getAppointmentServiceTotal(appointment, services);

        return total + serviceTotal;
      }, 0)
    : 0;
  const currentMonth = todayIso.slice(0, 7);
  const monthAppointments = displayAppointments.filter(
    (appointment) =>
      String(appointment?.appointment_date || "").startsWith(currentMonth) &&
      appointment?.status !== "canceled",
  );
  const monthExpectedRevenue = revenueAvailable
    ? monthAppointments.reduce((total, appointment) => {
        const serviceTotal =
          appointment.final_price !== null &&
          appointment.final_price !== undefined
            ? Number(appointment.final_price || 0)
            : getAppointmentServiceTotal(appointment, services);

        return total + serviceTotal;
      }, 0)
    : 0;

  function getServiceSummary(serviceNames: string[]) {
    if (serviceNames.length === 0) return "No service selected";
    if (serviceNames.length <= 2) return serviceNames.join(", ");

    return `${serviceNames.slice(0, 2).join(", ")} +${
      serviceNames.length - 2
    } more`;
  }

  function getAppointmentTotals(appointment: any) {
    const appointmentServices = getAppointmentServices(appointment);

    const totalDuration =
      Number(appointment.duration_minutes || 0) ||
      appointmentServices.reduce(
        (sum: number, service: any) =>
          sum + Number(service.duration_minutes || 0),
        0,
      );

    const totalPrice =
      appointment.final_price !== null && appointment.final_price !== undefined
        ? Number(appointment.final_price || 0)
        : appointmentServices.reduce(
            (sum: number, service: any) => sum + Number(service.price || 0),
            0,
          );

    return {
      appointmentServices,
      totalDuration,
      totalPrice,
    };
  }

  function QuickAction({
    title,
    subtitle,
    icon,
    route,
  }: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    route: string;
  }) {
    return (
      <AppCard
        onPress={() => router.push(route as any)}
        style={{
          width: quickActionCardWidth,
          minHeight: 100,
          borderColor: dashboardCardBorder,
          paddingVertical: 14,
          ...dashboardCardShadow,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: dashboardGreenSoft,
            borderColor: `${colors.primary}55`,
            borderWidth: 1,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
          }}
        >
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(16),
            fontWeight: "900",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: getFontSize(13),
            lineHeight: 18,
            marginTop: 4,
          }}
        >
          {subtitle}
        </Text>
      </AppCard>
    );
  }

  function DashboardMetric({
    label,
    value,
    helper,
    route,
  }: {
    label: string;
    value: number;
    helper: string;
    route: string;
  }) {
    return (
      <AppCard
        onPress={() => router.push(route as any)}
        style={{
          width: "48%",
          minHeight: 124,
          borderColor: dashboardAccentBorder,
          borderTopWidth: 3,
          padding: 14,
          ...dashboardCardShadow,
        }}
      >
        <View
          style={{
            width: 34,
            height: 4,
            borderRadius: 999,
            backgroundColor: dashboardSummaryAccent,
            marginBottom: 10,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <View
            style={{
              backgroundColor: dashboardAccentSoft,
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <Text
              style={{
                color: dashboardSummaryAccent,
                fontSize: getFontSize(12),
                fontWeight: "800",
                textTransform: "uppercase",
              }}
            >
              {label}
            </Text>
          </View>
          <Text
            style={{
              color: dashboardSummaryAccent,
              fontSize: getFontSize(19),
              fontWeight: "900",
            }}
          >
            ›
          </Text>
        </View>

        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(28),
            fontWeight: "900",
            marginTop: 8,
          }}
        >
          {value}
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: getFontSize(12),
            lineHeight: 17,
            marginTop: 6,
          }}
        >
          {helper}
        </Text>
        <Text
          style={{
            color: dashboardSummaryAccent,
            fontSize: getFontSize(11),
            fontWeight: "800",
            marginTop: 6,
          }}
        >
          Tap to view
        </Text>
      </AppCard>
    );
  }

  function SectionTitle({ children }: { children: string }) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
          marginBottom: 14,
        }}
      >
        <View
          style={{
            width: 4,
            height: 20,
            borderRadius: 999,
            backgroundColor: dashboardSummaryAccent,
          }}
        />
        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(21),
            fontWeight: "900",
            letterSpacing: 0.1,
          }}
        >
          {children}
        </Text>
      </View>
    );
  }

  function AppointmentConfirmationChip({ appointment }: { appointment: any }) {
    const confirmationStatus = getAppointmentConfirmationStatus(
      appointment,
      latestRepliesByAppointmentId[String(appointment?.id || "")],
    );

    if (!confirmationStatus) return null;

    const label = getAppointmentConfirmationLabel(confirmationStatus);
    const chipColor =
      confirmationStatus === "confirmed"
        ? "#16A34A"
        : confirmationStatus === "declined"
          ? "#DC2626"
          : dashboardStatusAccent;

    return (
      <View
        accessibilityLabel={`Client confirmation status: ${label}`}
        style={{
          alignSelf: "flex-start",
          backgroundColor: `${chipColor}12`,
          borderColor: `${chipColor}66`,
          borderWidth: 1,
          borderRadius: 999,
          paddingHorizontal: 9,
          paddingVertical: 4,
        }}
      >
        <Text
          numberOfLines={1}
          style={{
            color: chipColor,
            fontSize: getFontSize(11),
            fontWeight: "900",
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  function AppointmentCard({ appointment }: { appointment: any }) {
    if (!isDashboardAppointmentVisible(appointment)) return null;

    const { appointmentServices, totalDuration, totalPrice } =
      getAppointmentTotals(appointment);
    const serviceSummary = getServiceSummary(
      appointmentServices.map((service: any) => service.name).filter(Boolean),
    );
    const openEdit = () => openAppointmentEdit(appointment);
    const cardDetails = (
      <>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: getFontSize(17),
                fontWeight: "900",
              }}
            >
              {getClientDisplayName(appointment)}
            </Text>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                color: colors.mutedText,
                fontSize: getFontSize(14),
                marginTop: 5,
              }}
            >
              {serviceSummary}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <StatusBadge status={appointment.status} />
            <AppointmentConfirmationChip appointment={appointment} />
          </View>
        </View>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: getFontSize(14),
            fontWeight: "700",
            marginTop: 10,
          }}
        >
          {formatAppointmentTimeRange(appointment, totalDuration)} -{" "}
          {formatDate(appointment.appointment_date)}
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: getFontSize(13),
            marginTop: 4,
          }}
        >
          {totalDuration} min - ${totalPrice.toFixed(2)}
        </Text>

        {appointment.appointment_notes ? (
          <Text
            style={{
              color: colors.text,
              fontSize: getFontSize(13),
              marginTop: 8,
              lineHeight: 19,
            }}
            numberOfLines={2}
          >
            {appointment.appointment_notes}
          </Text>
        ) : null}
      </>
    );

    return (
      <AppCard
        onPress={Platform.OS === "web" ? undefined : openEdit}
        variant="subtle"
        style={{
          backgroundColor: colors.card,
          borderColor: dashboardAccentBorder,
          borderLeftColor: dashboardStatusAccent,
          borderLeftWidth: 4,
          borderWidth: 1,
          marginBottom: 12,
          ...dashboardCardShadow,
        }}
      >
        {Platform.OS === "web" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open appointment for ${getClientDisplayName(
              appointment,
            )}`}
            onPress={openEdit}
            style={({ pressed }) => ({ opacity: pressed ? 0.86 : 1 })}
          >
            {cardDetails}
          </Pressable>
        ) : null}
        {Platform.OS !== "web" ? cardDetails : null}

        <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
          <AppButton
            title="Edit"
            variant="primary"
            fullWidth={false}
            onPress={() => openAppointmentEdit(appointment)}
            style={{ flex: 1 }}
            textStyle={{ fontSize: getFontSize(13) }}
          />
          <AppButton
            title="Status"
            variant="secondary"
            fullWidth={false}
            onPress={() => {
              setSelectedStatusAppointment(appointment);
              setStatusModalOpen(true);
            }}
            style={{
              flex: 1,
              backgroundColor: dashboardStatusAccent,
              borderColor: dashboardStatusAccent,
            }}
            textStyle={{ color: "#FFFFFF", fontSize: getFontSize(13) }}
          />
          <AppButton
            title="Delete"
            variant="destructive"
            fullWidth={false}
            onPress={() => {
              void deleteAppointment(appointment.id);
            }}
            style={{ flex: 1 }}
            textStyle={{ fontSize: getFontSize(13) }}
          />
        </View>
      </AppCard>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={72}>
      <ScreenHeader
        title="Dashboard"
        subtitle="Your day at a glance."
        rightAction={
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Client replies"
              accessibilityHint="View client text replies"
              onPress={openClientReplies}
              hitSlop={10}
              style={{
                position: "relative",
                width: 30,
                height: 30,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="mail-unread-outline"
                size={24}
                color={colors.text}
              />
              {clientRepliesCount > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -7,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 999,
                    backgroundColor: "#DC2626",
                    borderWidth: 1,
                    borderColor: colors.card,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 4,
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 10,
                      fontWeight: "900",
                      lineHeight: 12,
                    }}
                  >
                    {clientRepliesBadgeText}
                  </Text>
                </View>
              ) : null}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={() => router.push("/settings" as any)}
              hitSlop={10}
            >
              <Ionicons name="settings-outline" size={28} color={colors.text} />
            </Pressable>
          </View>
        }
      />

      {userEmail ? (
        <Text
          style={{
            color: colors.mutedText,
            fontSize: getFontSize(11),
            marginTop: -12,
            marginBottom: 18,
            opacity: 0.78,
          }}
        >
          Account: {userEmail}
        </Text>
      ) : null}

      {hasBusiness === false ? (
        <AppCard
          onPress={() => router.push("/business-setup" as any)}
          style={{ marginBottom: 24 }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: getFontSize(18),
              fontWeight: "900",
              marginBottom: 6,
            }}
          >
            Set up your business
          </Text>
          <Text
            style={{
              color: colors.mutedText,
              fontSize: getFontSize(14),
              lineHeight: 20,
            }}
          >
            Add your business info to personalize your schedule.
          </Text>
        </AppCard>
      ) : null}

      <SectionTitle>Today summary</SectionTitle>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 26,
        }}
      >
        <DashboardMetric
          label="Today"
          value={todaysAppointments.length}
          helper={todayMetricHelper}
          route="/calendar-view"
        />
        <DashboardMetric
          label="Upcoming"
          value={upcomingAppointments.length}
          helper={upcomingMetricHelper}
          route="/calendar-view"
        />
        <DashboardMetric
          label="Clients"
          value={clients.length}
          helper="Saved"
          route="/clients"
        />
        <DashboardMetric
          label="Services"
          value={services.length}
          helper="Active"
          route="/add-service"
        />
      </View>

      <SectionTitle>Quick actions</SectionTitle>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 26,
        }}
      >
        <QuickAction
          title="Book Appointment"
          subtitle="Add to schedule"
          icon="calendar-outline"
          route="/book-appointment"
        />
        <QuickAction
          title="Add Client"
          subtitle="Save client info"
          icon="people-outline"
          route="/clients"
        />
        <QuickAction
          title="Add Service"
          subtitle="Prices and duration"
          icon="briefcase-outline"
          route="/add-service"
        />
      </View>

      <SectionTitle>Business snapshot</SectionTitle>
      <AppCard style={{ marginBottom: 26 }}>
        <View
          style={{
            width: 42,
            height: 4,
            borderRadius: 999,
            backgroundColor: dashboardSummaryAccent,
            marginBottom: 14,
          }}
        />
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.mutedText,
                fontSize: getFontSize(13),
                fontWeight: "800",
              }}
            >
              This month
            </Text>
            <Text
              style={{
                color: colors.text,
                fontSize: getFontSize(28),
                fontWeight: "900",
                marginTop: 4,
              }}
            >
              {monthAppointments.length}
            </Text>
            <Text style={{ color: colors.mutedText, marginTop: 2 }}>
              appointments
            </Text>
          </View>

          {ENABLE_PRO ? (
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: getFontSize(13),
                  fontWeight: "800",
                  textAlign: "right",
                }}
              >
                Expected revenue
              </Text>
              {revenueAvailable ? (
                <>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: getFontSize(28),
                      fontWeight: "900",
                      marginTop: 4,
                      textAlign: "right",
                    }}
                  >
                    ${monthExpectedRevenue.toFixed(2)}
                  </Text>
                  <Text style={{ color: colors.mutedText, marginTop: 2 }}>
                    this month
                  </Text>
                </>
              ) : (
                <AppButton
                  title="Pro"
                  variant="secondary"
                  fullWidth={false}
                  onPress={openSchedovaProScreen}
                  style={{ marginTop: 8, minHeight: 36, paddingVertical: 6 }}
                  textStyle={{ fontSize: getFontSize(13) }}
                />
              )}
            </View>
          ) : null}
        </View>

        {ENABLE_PRO ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              marginTop: 18,
              paddingTop: 18,
              flexDirection: "row",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
                Today revenue
              </Text>
              {revenueAvailable ? (
                <Text
                  style={{
                    color: colors.text,
                    fontSize: getFontSize(22),
                    fontWeight: "900",
                    marginTop: 4,
                  }}
                >
                  ${estimatedRevenue.toFixed(2)}
                </Text>
              ) : (
                <Text style={{ color: colors.mutedText, marginTop: 4 }}>
                  Pro feature
                </Text>
              )}
            </View>
            {!revenueAvailable ? (
              <AppButton
                title="View Pro"
                variant="secondary"
                fullWidth={false}
                onPress={openSchedovaProScreen}
                style={{ minHeight: 42, paddingVertical: 8 }}
                textStyle={{ fontSize: getFontSize(13) }}
              />
            ) : null}
          </View>
        ) : null}
      </AppCard>

      <SectionTitle>Today appointments</SectionTitle>
      {todaysAppointments.length === 0 ? (
        <EmptyState
          title="No appointments today"
          message="Book an appointment or check your calendar for what is next."
          actionLabel="Book Appointment"
          onAction={() => router.push("/book-appointment" as any)}
          style={{ marginBottom: 26 }}
        />
      ) : (
        <View style={{ marginBottom: 18 }}>
          {todaysAppointments.map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))}
        </View>
      )}

      <SectionTitle>Upcoming appointments</SectionTitle>
      <AppCard>
        {upcomingAppointments.length === 0 ? (
          <Text
            style={{
              color: colors.mutedText,
              fontSize: getFontSize(15),
              textAlign: "center",
              paddingVertical: 16,
            }}
          >
            No upcoming appointments yet.
          </Text>
        ) : (
          upcomingAppointments.map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))
        )}
      </AppCard>

      <Modal visible={statusModalOpen} transparent animationType="fade">
        <Pressable
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            padding: 24,
          }}
          onPress={() => setStatusModalOpen(false)}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 22,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: getFontSize(22),
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
              Change Status
            </Text>

            <Text
              style={{
                color: colors.mutedText,
                marginBottom: 18,
              }}
            >
              {selectedStatusAppointment?.client_name || "Appointment"}
            </Text>

            <Pressable
              onPress={() => setStatusModalOpen(false)}
              style={{
                position: "absolute",
                right: 16,
                top: 16,
              }}
            >
              <Text style={{ color: colors.mutedText, fontSize: 18 }}>x</Text>
            </Pressable>

            <AppButton
              title="Completed"
              onPress={async () => {
                await updateAppointmentStatus("completed");
              }}
              style={{ marginBottom: 10, backgroundColor: "#16A34A" }}
            />

            <AppButton
              title="No Show"
              onPress={async () => {
                await updateAppointmentStatus("no_show");
              }}
              style={{ marginBottom: 10, backgroundColor: "#D97706" }}
            />

            <AppButton
              title="Canceled"
              variant="destructive"
              onPress={async () => {
                await updateAppointmentStatus("canceled");
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </AppScreen>
  );
}
