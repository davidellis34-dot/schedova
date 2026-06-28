import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import SwipeDownSheet from "../components/SwipeDownSheet";
import { AppScreen } from "../components/layout/AppScreen";
import { getAppointmentServices as getSavedAppointmentServices } from "../lib/appointmentServices";
import { sortAppointmentsChronologically } from "../lib/appointmentSort";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { formatClockTime, getCalendarPreferences } from "../lib/calendarPreferences";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { isSchedovaInternalDebugMode } from "../lib/debugMode";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { showProUpgradePrompt } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type AppointmentTab = "upcoming" | "completed" | "canceled";

type Appointment = {
  id: string;
  client_name?: string | null;
  service_id?: string;
  appointment_date?: string | null;
  appointment_time?: string | null;
  end_time?: string | null;
  duration_minutes?: number | null;
  status?: string | null;
  archived?: boolean;
  appointment_notes?: string | null;
  tip_amount?: number | null;
};

function logAppointmentListCardDebug(label: string, details: Record<string, unknown>) {
  if (!isSchedovaInternalDebugMode()) return;
  console.log(label, details);
}
export default function AppointmentsList() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  useFeatureAccess();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<AppointmentTab>("upcoming");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(
    null,
  );
  const [actionAppointment, setActionAppointment] = useState<Appointment | null>(
    null,
  );
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [tipAmount, setTipAmount] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [use24Hour, setUse24Hour] = useState(false);
  const longPressHandledAppointmentId = useRef<string | null>(null);

  function canUseProFeature(feature: Parameters<typeof canUseFeature>[0]) {
    return canUseFeature(feature);
  }

  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  function getStatusAccent(status?: string | null) {
    switch (status) {
      case "completed":
        return "#16A34A";
      case "canceled":
      case "customer_canceled":
      case "business_canceled":
        return "#DC2626";
      case "no_show":
        return "#D97706";
      default:
        return infoAccent;
    }
  }

  const loadCalendarPreferences = useCallback(async () => {
    const preferences = await getCalendarPreferences();
    setUse24Hour(preferences.timeFormat === "24h");
  }, []);

  async function getCurrentUserIdOrAlert() {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      Alert.alert("Not signed in", "Please sign in again.");
      return "";
    }

    return user.id;
  }

  function formatTime(timeString?: string | null) {
    return formatClockTime(timeString, use24Hour);
  }

  function timeToMinutes(timeString?: string | null) {
    const [hours, minutes] = String(timeString || "00:00")
      .slice(0, 5)
      .split(":")
      .map(Number);

    return (
      (Number.isFinite(hours) ? hours : 0) * 60 +
      (Number.isFinite(minutes) ? minutes : 0)
    );
  }

  function minutesToTime(minutes: number) {
    const safeMinutes = ((Math.round(minutes) % 1440) + 1440) % 1440;
    const hours = Math.floor(safeMinutes / 60);
    const remainingMinutes = safeMinutes % 60;

    return `${String(hours).padStart(2, "0")}:${String(
      remainingMinutes,
    ).padStart(2, "0")}`;
  }

  function getAppointmentDurationMinutes(appointment: any) {
    const savedDuration = Number(appointment?.duration_minutes);

    if (Number.isFinite(savedDuration) && savedDuration > 0) {
      return Math.round(savedDuration);
    }

    const startMinutes = timeToMinutes(appointment?.appointment_time);
    const endMinutes = appointment?.end_time
      ? timeToMinutes(appointment.end_time)
      : Number.NaN;

    if (Number.isFinite(endMinutes) && endMinutes > startMinutes) {
      return endMinutes - startMinutes;
    }

    return getAppointmentServices(appointment).reduce(
      (sum: number, service: any) => sum + Number(service?.duration_minutes || 0),
      0,
    );
  }

  function getAppointmentEndTime(appointment: any) {
    const duration = getAppointmentDurationMinutes(appointment);
    if (duration && appointment?.appointment_time) {
      return minutesToTime(timeToMinutes(appointment.appointment_time) + duration);
    }

    return appointment?.end_time || "";
  }

  function formatAppointmentTimeRange(appointment: any) {
    const start = formatTime(appointment?.appointment_time);
    const end = formatTime(getAppointmentEndTime(appointment));

    return end ? `${start} - ${end}` : start;
  }

  const fetchData = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) return;

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .order("appointment_date", { ascending: true })
      .order("appointment_time", { ascending: true });

    const servicesResult = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    const clientsResult = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId);

    if (appointmentsResult.error) {
      Alert.alert("Error", appointmentsResult.error.message);
      return;
    }

    setAppointments(
      sortAppointmentsChronologically(
        ((appointmentsResult.data || []).filter(Boolean)) as Appointment[],
      ),
    );
    setServices((servicesResult.data || []).filter(Boolean));
    setClients((clientsResult.data || []).filter(Boolean));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void fetchData();
      void loadCalendarPreferences();
    }, [fetchData, loadCalendarPreferences]),
  );

  function getClientByName(name?: string | null) {
    return clients.find((client) => client?.name === name);
  }

  function formatLocalDate(date: Date) {
    return (
      `${date.getFullYear()}-` +
      `${String(date.getMonth() + 1).padStart(2, "0")}-` +
      `${String(date.getDate()).padStart(2, "0")}`
    );
  }

  function getRebookDate(appointment: any) {
    const dateText = String(appointment?.appointment_date || "");
    const [year, month, day] = dateText.split("-").map(Number);

    if (!year || !month || !day) return null;

    const client = getClientByName(appointment?.client_name);
    const weeks = Number(client?.rebooking_weeks || 6);
    const date = new Date(year, month - 1, day);

    date.setDate(date.getDate() + weeks * 7);

    return formatLocalDate(date);
  }

  function filteredAppointments() {
    if (activeTab === "upcoming") {
      return sortAppointmentsChronologically(
        appointments.filter(
          (a) => a && (a.status === "scheduled" || !a.status) && !a.archived,
        ),
      );
    }

    if (activeTab === "completed") {
      return sortAppointmentsChronologically(
        appointments.filter(
          (a) => a && a.status === "completed" && !a.archived,
        ),
      );
    }

    return sortAppointmentsChronologically(
      appointments.filter(
        (a) =>
          a &&
          !a.archived &&
          (a.status === "canceled" ||
            a.status === "customer_canceled" ||
            a.status === "business_canceled" ||
            a.status === "no_show"),
      ),
    );
  }

  function openAppointment(appointment: any) {
    if (!appointment?.id) {
      Alert.alert("Error", "No appointment ID found.");
      return;
    }

    logAppointmentListCardDebug("Schedova 1.1.1 appointment card handler active", {
      surface: "appointments-list",
      gesture: "open-flow",
      appointmentId: appointment.id,
    });
    logAppointmentListCardDebug("[appointments-list flow] openAppointment", {
      appointmentId: appointment.id,
      clientName: appointment.client_name || "",
    });

    setSelectedAppointment(appointment);
    setTipAmount(String(appointment.tip_amount ?? ""));
    setAppointmentNotes(appointment.appointment_notes ?? "");
  }

  function shouldIgnoreAppointmentPress(appointmentId: string) {
    if (longPressHandledAppointmentId.current !== appointmentId) {
      return false;
    }

    longPressHandledAppointmentId.current = null;
    return true;
  }

  async function saveTip() {
    if (!selectedAppointment?.id) {
      Alert.alert("Error", "No appointment selected.");
      return;
    }

    const tipValue = Number(tipAmount);

    if (Number.isNaN(tipValue)) {
      Alert.alert("Error", "Tip must be a number.");
      return;
    }

    const userId = await getCurrentUserIdOrAlert();
    if (!userId) return;

    const { data, error } = await supabase
      .from("appointments")
      .update({ tip_amount: tipValue })
      .eq("id", selectedAppointment.id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    if (!data) {
      Alert.alert("Error", "No appointment was updated.");
      return;
    }

    setSelectedAppointment(data);
    setTipAmount(String(data.tip_amount ?? ""));

    setAppointments((current) =>
      sortAppointmentsChronologically(
        current.map((appointment) =>
          appointment.id === data.id ? data : appointment,
        ),
      ),
    );
  }

  async function saveNotes() {
    if (!selectedAppointment?.id) return;

    const userId = await getCurrentUserIdOrAlert();
    if (!userId) return;

    const { data, error } = await supabase
      .from("appointments")
      .update({ appointment_notes: appointmentNotes })
      .eq("id", selectedAppointment.id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    if (data) {
      setSelectedAppointment(data);
      setAppointments((current) =>
        sortAppointmentsChronologically(
          current.map((appointment) =>
            appointment.id === data.id ? data : appointment,
          ),
        ),
      );
    }
  }

  async function updateAppointmentStatus(id: string, status: string) {
    if (!id) {
      Alert.alert("Error", "No appointment ID found.");
      return;
    }

    const userId = await getCurrentUserIdOrAlert();
    if (!userId) return;

    const { data, error } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", id)
      .eq("user_id", userId)
      .select("*")
      .maybeSingle();

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    if (data) {
      if (status === "canceled") {
        if (canUseProFeature("smsAutomation")) {
          void sendAppointmentSmsNonBlocking(id, "cancellation");
        }
        await cancelAppointmentReminder(id);
      }

      setAppointments((current) =>
        sortAppointmentsChronologically(
          current.map((appointment) =>
            appointment.id === data.id ? data : appointment,
          ),
        ),
      );

      if (selectedAppointment?.id === data.id) {
        setSelectedAppointment(data);
      }
    }
  }

  async function deleteAppointment(id: string) {
    if (!id) {
      Alert.alert("Error", "No appointment ID found.");
      return;
    }

    await confirmDestructiveAction({
      title: "Delete Appointment",
      message: "Are you sure you want to delete this appointment?",
      confirmText: "Delete",
      onConfirm: async () => {
        const userId = await getCurrentUserIdOrAlert();
        if (!userId) return;

        if (canUseProFeature("smsAutomation")) {
          void sendAppointmentSmsNonBlocking(id, "cancellation");
        }

        const { error } = await supabase
          .from("appointments")
          .delete()
          .eq("id", id)
          .eq("user_id", userId);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }

        await cancelAppointmentReminder(id);
        setAppointments((current) =>
          current.filter((appointment) => appointment.id !== id),
        );
        setSelectedAppointment(null);
      },
    });
  }

  function editAppointment(appointmentId?: string) {
    if (!appointmentId) {
      Alert.alert("Error", "No appointment ID found.");
      return;
    }

    setActionAppointment(null);
    setSelectedAppointment(null);

    router.push({
      pathname: "/book-appointment",
      params: {
        appointmentId,
        mode: "edit",
      },
    });
  }

  function canCancelAppointment(status?: string | null) {
    return status === "scheduled" || !status;
  }

  async function archiveSelectedAppointments() {
    const userId = await getCurrentUserIdOrAlert();
    if (!userId) return;

    const { error } = await supabase
      .from("appointments")
      .update({ archived: true })
      .in("id", selectedIds)
      .eq("user_id", userId);

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setAppointments((current) =>
      current.map((appointment) =>
        selectedIds.includes(appointment.id)
          ? { ...appointment, archived: true }
          : appointment,
      ),
    );

    setSelectedIds([]);
    setSelectMode(false);
  }

  async function deleteSelectedAppointments() {
    if (selectedIds.length === 0) return;

    await confirmDestructiveAction({
      title: "Delete Selected Appointments?",
      message: `Delete ${selectedIds.length} selected appointment${
        selectedIds.length === 1 ? "" : "s"
      }?`,
      confirmText: "Delete",
      onConfirm: async () => {
        const userId = await getCurrentUserIdOrAlert();
        if (!userId) return;

        if (canUseProFeature("smsAutomation")) {
          await Promise.all(
            selectedIds.map((appointmentId) =>
              sendAppointmentSmsNonBlocking(appointmentId, "cancellation"),
            ),
          );
        }

        const { error } = await supabase
          .from("appointments")
          .delete()
          .in("id", selectedIds)
          .eq("user_id", userId);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }

        await Promise.all(
          selectedIds.map((appointmentId) =>
            cancelAppointmentReminder(appointmentId),
          ),
        );

        setAppointments((current) =>
          current.filter((appointment) => !selectedIds.includes(appointment.id)),
        );

        setSelectedIds([]);
        setSelectMode(false);
      },
    });
  }

  function bulkReschedule() {
    if (!ENABLE_PRO) return;

    showProUpgradePrompt(
      "Smart rescheduling and follow-up tools are included with Schedova Pro.",
    );
  }

  function StatusBadge({ appointment }: { appointment: any }) {
    const status = appointment.status || "scheduled";
    const statusAccent = getStatusAccent(status);
    const scheduled = status === "scheduled";

    return (
      <View
        style={{
          backgroundColor: scheduled ? statusAccent : `${statusAccent}18`,
          borderColor: statusAccent,
          borderWidth: 1,
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 999,
        }}
      >
        <Text
          style={{
            color: scheduled ? "#FFFFFF" : statusAccent,
            fontSize: 12,
            fontWeight: "900",
          }}
        >
          {status}
        </Text>
      </View>
    );
  }

  function TabButton({ label, tab }: { label: string; tab: AppointmentTab }) {
    const active = activeTab === tab;

    return (
      <Pressable
        onPress={() => setActiveTab(tab)}
        style={{
          flex: 1,
          backgroundColor: active ? infoAccent : colors.card,
          borderColor: active ? infoAccent : polishedBorder,
          borderWidth: 1,
          padding: 12,
          borderRadius: 999,
          alignItems: "center",
        }}
      >
        <Text
          style={{ color: active ? "#FFFFFF" : colors.text, fontWeight: "900" }}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
  function getAppointmentServices(appointment: any) {
    return getSavedAppointmentServices(appointment, services);
  }
  const shownAppointments = filteredAppointments()
    .filter((appointment) => Boolean(appointment?.id))
    .slice(0, 50);
  const actionAppointmentServices = actionAppointment
    ? getAppointmentServices(actionAppointment)
    : [];

  const selectedAppointmentServices = selectedAppointment
    ? getAppointmentServices(selectedAppointment)
    : [];

  const selectedClient = selectedAppointment
    ? getClientByName(selectedAppointment.client_name)
    : null;

  const selectedRebookDate =
    selectedAppointment?.status === "completed"
      ? getRebookDate(selectedAppointment)
      : null;

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <View
          style={{
            width: 4,
            height: 24,
            borderRadius: 999,
            backgroundColor: infoAccent,
          }}
        />
        <Text
          style={{
            fontSize: 28,
            fontWeight: "bold",
            color: colors.text,
          }}
        >
          Appointments
        </Text>
      </View>

      <View style={{ flexDirection: "row", marginBottom: 20 }}>
        <TabButton label="Upcoming" tab="upcoming" />
        <View style={{ width: 10 }} />
        <TabButton label="Completed" tab="completed" />
        <View style={{ width: 10 }} />
        <TabButton label="Canceled" tab="canceled" />
      </View>

      {activeTab !== "upcoming" && (
        <Pressable
          onPress={() => {
            setSelectMode(!selectMode);
            setSelectedIds([]);
          }}
          style={{
            backgroundColor: colors.card,
            paddingVertical: 12,
            borderColor: infoAccentBorder,
            borderWidth: 1,
            borderRadius: 999,
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "bold" }}>
            {selectMode ? "Done Selecting" : "Select Appointments"}
          </Text>
        </Pressable>
      )}

      {shownAppointments.length === 0 && (
        <Text style={{ color: colors.mutedText }}>No appointments here.</Text>
      )}

      {shownAppointments.map((appointment) => {
        const appointmentServices = getAppointmentServices(appointment);
        const service = appointmentServices[0];
        const statusAccent = getStatusAccent(appointment.status);

        return (
          <Pressable
            key={appointment.id}
            onPress={() => {
              logAppointmentListCardDebug(
                "Schedova 1.1.1 appointment card handler active",
                {
                  surface: "appointments-list",
                  gesture: "press",
                  appointmentId: appointment.id,
                },
              );
              logAppointmentListCardDebug("[appointments-list card] onPress", {
                appointmentId: appointment.id,
                clientName: appointment.client_name || "",
                status: appointment.status || "scheduled",
              });

              if (shouldIgnoreAppointmentPress(appointment.id)) {
                logAppointmentListCardDebug("[appointments-list card] onPress ignored", {
                  appointmentId: appointment.id,
                });
                return;
              }

              if (selectMode) {
                if (selectedIds.includes(appointment.id)) {
                  setSelectedIds(
                    selectedIds.filter((id) => id !== appointment.id),
                  );
                } else {
                  setSelectedIds([...selectedIds, appointment.id]);
                }

                return;
              }

              openAppointment(appointment);
            }}
            onLongPress={() => {
              if (selectMode) return;

              logAppointmentListCardDebug(
                "Schedova 1.1.1 appointment card handler active",
                {
                  surface: "appointments-list",
                  gesture: "longPress",
                  appointmentId: appointment.id,
                },
              );
              logAppointmentListCardDebug("[appointments-list card] onLongPress", {
                appointmentId: appointment.id,
                clientName: appointment.client_name || "",
                status: appointment.status || "scheduled",
              });

              longPressHandledAppointmentId.current = appointment.id;
              setActionAppointment(appointment);
            }}
            delayLongPress={250}
            style={{
              backgroundColor: colors.card,
              borderLeftWidth: 5,
              borderLeftColor: statusAccent,
              padding: 18,
              borderRadius: 18,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: polishedBorder,
              opacity:
                selectMode && selectedIds.includes(appointment.id) ? 0.92 : 1,
            }}
          >
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 999,
                backgroundColor: service?.color_hex || infoAccent,
                marginBottom: 12,
              }}
            />
            <Text
              style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}
            >
              {appointment.client_name || "No client name"}
            </Text>

            <Text
              style={{ marginTop: 5, fontWeight: "bold", color: colors.text }}
            >
              {appointmentServices.length > 0
                ? appointmentServices
                    .map((service: any) => service?.name)
                    .filter(Boolean)
                    .join(", ")
                : "No service selected"}
            </Text>

            <Text style={{ marginTop: 6, color: colors.text }}>
              {appointment.appointment_date || "Date not set"} at{" "}
              {formatAppointmentTimeRange(appointment)}
            </Text>

            {Number(appointment.tip_amount || 0) > 0 && (
              <Text
                style={{ marginTop: 8, color: colors.text, fontWeight: "bold" }}
              >
                Tip: ${Number(appointment.tip_amount || 0).toFixed(2)}
              </Text>
            )}

            {appointment.appointment_notes ? (
              <Text style={{ marginTop: 10, color: colors.mutedText }}>
                Notes: {appointment.appointment_notes}
              </Text>
            ) : null}

            {selectMode && (
              <View
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: colors.primary,
                  backgroundColor: selectedIds.includes(appointment.id)
                    ? colors.primary
                    : colors.card,
                  justifyContent: "center",
                  alignItems: "center",
                  zIndex: 10,
                }}
              >
                <Text
                  style={{
                    color: selectedIds.includes(appointment.id)
                      ? "#ffffff"
                      : colors.primary,
                    fontWeight: "bold",
                  }}
                >
                  {"\u2713"}
                </Text>
              </View>
            )}

            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginTop: 12,
              }}
            >
              <StatusBadge appointment={appointment} />

              {appointment.status === "completed" &&
                canUseProFeature("smartReminders") && (
                <Text
                  style={{
                    marginLeft: 14,
                    color: infoAccent,
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  Rebook: {getRebookDate(appointment)}
                </Text>
              )}
            </View>

          </Pressable>
        );
      })}

      <SwipeDownSheet
        visible={!!actionAppointment}
        onClose={() => {
          longPressHandledAppointmentId.current = null;
          setActionAppointment(null);
        }}
        backgroundColor={colors.background}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 22,
            fontWeight: "bold",
          }}
        >
          {actionAppointment?.client_name || "Appointment"}
        </Text>

        <Text style={{ color: colors.mutedText, marginTop: 6 }}>
          {actionAppointment?.appointment_date} at{" "}
          {formatAppointmentTimeRange(actionAppointment)}
        </Text>

        {actionAppointmentServices.length > 0 ? (
          <Text style={{ color: colors.mutedText, marginTop: 4 }}>
            {actionAppointmentServices
              .map((service: any) => service?.name)
              .filter(Boolean)
              .join(", ")}
          </Text>
        ) : null}

        <View style={{ gap: 12, marginTop: 20 }}>
          <Pressable
            onPress={() => {
              if (!actionAppointment) return;
              setActionAppointment(null);
              openAppointment(actionAppointment);
            }}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: polishedBorder,
              borderRadius: 14,
              padding: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "bold" }}>
              View Details
            </Text>
          </Pressable>

          <Pressable
            onPress={() => editAppointment(actionAppointment?.id)}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 14,
              padding: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "bold" }}>
              Edit Appointment
            </Text>
          </Pressable>

          {canCancelAppointment(actionAppointment?.status) ? (
            <Pressable
              onPress={async () => {
                if (!actionAppointment?.id) return;
                setActionAppointment(null);
                await updateAppointmentStatus(actionAppointment.id, "canceled");
              }}
              style={{
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: "#DC2626",
                borderRadius: 14,
                padding: 14,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#DC2626", fontWeight: "bold" }}>
                Cancel Appointment
              </Text>
            </Pressable>
          ) : null}

          <Pressable
            onPress={async () => {
              if (!actionAppointment?.id) return;
              setActionAppointment(null);
              await deleteAppointment(actionAppointment.id);
            }}
            style={{
              backgroundColor: "#DC2626",
              borderRadius: 14,
              padding: 14,
              alignItems: "center",
            }}
          >
            <Text style={{ color: "#ffffff", fontWeight: "bold" }}>
              Delete Appointment
            </Text>
          </Pressable>
        </View>
      </SwipeDownSheet>

      <Modal visible={!!selectedAppointment} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={{ flex: 1 }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.4)",
              justifyContent: "flex-end",
            }}
          >
            <View
              style={{
                backgroundColor: colors.background,
                padding: 24,
                paddingBottom: insets.bottom + 24,
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderColor: infoAccentBorder,
                borderTopWidth: 1,
                maxHeight: "88%",
              }}
            >
              <Pressable
                onPress={() => setSelectedAppointment(null)}
                style={{
                  width: 80,
                  height: 24,
                  alignSelf: "center",
                  marginBottom: 14,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                <View
                  style={{
                    width: 50,
                    height: 5,
                    borderRadius: 999,
                    backgroundColor: "#D1D5DB",
                  }}
                />
              </Pressable>

              <ScrollView keyboardShouldPersistTaps="handled">
              <Pressable
                onPress={() => {
                  editAppointment(selectedAppointment?.id);
                }}
                style={{
                  backgroundColor: colors.primary,
                  padding: 14,
                  borderRadius: 12,
                  alignItems: "center",
                  marginBottom: 18,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Edit Appointment
                </Text>
              </Pressable>

              <Text
                style={{
                  fontSize: 26,
                  fontWeight: "bold",
                  marginBottom: 10,
                  color: colors.text,
                }}
              >
                Appointment Details
              </Text>

              <View
                style={{
                  backgroundColor: colors.card,
                  borderLeftWidth: 5,
                  borderLeftColor: getStatusAccent(selectedAppointment?.status),
                  borderColor: polishedBorder,
                  borderWidth: 1,
                  padding: 18,
                  borderRadius: 14,
                  marginBottom: 18,
                }}
              >
                <Text
                  style={{
                    fontSize: 20,
                    fontWeight: "bold",
                    color: colors.text,
                  }}
                >
                  {selectedAppointment?.client_name}
                </Text>

                <Text style={{ marginTop: 6, color: colors.text }}>
                  Service:{" "}
                  {selectedAppointmentServices.length > 0
                    ? selectedAppointmentServices
                        .map((service: any) => service?.name)
                        .filter(Boolean)
                        .join(", ")
                    : "No service selected"}
                </Text>

                <Text style={{ color: colors.text }}>
                  Date: {selectedAppointment?.appointment_date}
                </Text>

                <Text style={{ color: colors.text }}>
                  Time: {formatAppointmentTimeRange(selectedAppointment)}
                </Text>

                <Text style={{ color: colors.text }}>
                  Duration: {getAppointmentDurationMinutes(selectedAppointment)} min
                </Text>

                <Text style={{ color: colors.text }}>
                  Status: {selectedAppointment?.status || "scheduled"}
                </Text>

                <Text style={{ color: colors.text, fontWeight: "bold" }}>
                  Tip: $
                  {Number(selectedAppointment?.tip_amount || 0).toFixed(2)}
                </Text>

                {["scheduled", "completed", "canceled", "no_show"].map(
                  (status) => (
                    <Pressable
                      key={status}
                      onPress={() => {
                        if (!selectedAppointment?.id) return;
                        updateAppointmentStatus(selectedAppointment.id, status);
                      }}
                      style={{
                        backgroundColor:
                          selectedAppointment?.status === status
                            ? infoAccentSoft
                            : colors.card,
                        padding: 12,
                        borderRadius: 12,
                        marginTop: 10,
                        borderWidth: 1,
                        borderColor:
                          selectedAppointment?.status === status
                            ? infoAccent
                            : polishedBorder,
                        alignItems: "center",
                      }}
                    >
                      <Text
                        style={{
                          color:
                            selectedAppointment?.status === status
                              ? infoAccent
                              : colors.text,
                          fontWeight: "bold",
                        }}
                      >
                        {status}
                      </Text>
                    </Pressable>
                  ),
                )}

                {selectedAppointment?.status === "completed" &&
                  canUseProFeature("smartReminders") && (
                  <View
                    style={{
                      backgroundColor: colors.card,
                      borderColor: infoAccentBorder,
                      borderWidth: 1,
                      padding: 16,
                      borderRadius: 12,
                      marginTop: 12,
                    }}
                  >
                    <Text
                      style={{
                        color: colors.text,
                        fontWeight: "bold",
                        marginBottom: 4,
                      }}
                    >
                      Rebooking Info
                    </Text>

                    <Text style={{ color: colors.text }}>
                      Rebooking Every: {selectedClient?.rebooking_weeks || 6}{" "}
                      weeks
                    </Text>

                    {!!selectedRebookDate && (
                      <Text
                        style={{ color: infoAccent, fontWeight: "bold" }}
                      >
                        Suggested Rebook: {selectedRebookDate}
                      </Text>
                    )}
                  </View>
                )}
              </View>

              <Text
                style={{
                  fontWeight: "bold",
                  marginBottom: 8,
                  color: colors.text,
                }}
              >
                Tip Amount
              </Text>

              <TextInput
                value={tipAmount}
                onChangeText={setTipAmount}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor="#888888"
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: polishedBorder,
                  padding: 14,
                  borderRadius: 12,
                  marginBottom: 10,
                  color: colors.text,
                }}
              />

              <Text
                style={{
                  fontWeight: "bold",
                  marginBottom: 8,
                  color: colors.text,
                }}
              >
                Appointment Notes
              </Text>

              <TextInput
                value={appointmentNotes}
                onChangeText={setAppointmentNotes}
                multiline
                placeholder="Client notes..."
                placeholderTextColor="#888888"
                style={{
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: polishedBorder,
                  borderRadius: 12,
                  padding: 14,
                  minHeight: 110,
                  textAlignVertical: "top",
                  color: colors.text,
                  marginBottom: 10,
                }}
              />

              <Pressable
                onPress={() => {
                  const appointmentId = selectedAppointment?.id;

                  if (!appointmentId) {
                    Alert.alert("Error", "No appointment ID found.");
                    return;
                  }

                  void deleteAppointment(appointmentId);
                }}
                style={{
                  backgroundColor: "#DC2626",
                  padding: 14,
                  borderRadius: 12,
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "bold" }}>
                  Delete Appointment
                </Text>
              </Pressable>

              <Pressable
                onPress={async () => {
                  await saveTip();
                  await saveNotes();
                  setSelectedAppointment(null);
                }}
                style={{
                  backgroundColor: colors.primary,
                  padding: 14,
                  borderRadius: 12,
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <Text style={{ color: "#ffffff", fontWeight: "bold" }}>
                  Save & Close
                </Text>
              </Pressable>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {selectMode && selectedIds.length > 0 && (
        <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
          {activeTab === "upcoming" ? (
            <>
              {ENABLE_PRO ? (
                <Pressable
                  onPress={bulkReschedule}
                  style={{
                    flex: 1,
                    backgroundColor: "#2563EB",
                    padding: 14,
                    borderRadius: 999,
                    alignItems: "center",
                  }}
                >
                  <Text style={{ color: "#fff", fontWeight: "bold" }}>
                    Reschedule ({selectedIds.length})
                  </Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={deleteSelectedAppointments}
                style={{
                  flex: 1,
                  backgroundColor: "#DC2626",
                  padding: 14,
                  borderRadius: 999,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Delete ({selectedIds.length})
                </Text>
              </Pressable>
            </>
          ) : (
            <>
              <Pressable
                onPress={archiveSelectedAppointments}
                style={{
                  flex: 1,
                  backgroundColor: colors.primary,
                  padding: 14,
                  borderRadius: 999,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Archive ({selectedIds.length})
                </Text>
              </Pressable>

              <Pressable
                onPress={deleteSelectedAppointments}
                style={{
                  flex: 1,
                  backgroundColor: "#DC2626",
                  padding: 14,
                  borderRadius: 999,
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "bold" }}>
                  Delete ({selectedIds.length})
                </Text>
              </Pressable>
            </>
          )}
        </View>
      )}
    </AppScreen>
  );
}
