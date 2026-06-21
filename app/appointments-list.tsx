import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
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
import { AppScreen } from "../components/layout/AppScreen";
import { getAppointmentServices as getSavedAppointmentServices } from "../lib/appointmentServices";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { formatClockTime, getCalendarPreferences } from "../lib/calendarPreferences";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type AppointmentTab = "upcoming" | "completed" | "canceled";

type Appointment = {
  id: string;
  client_name?: string;
  service_id?: string;
  appointment_date: string;
  appointment_time: string;
  status?: string;
  archived?: boolean;
  appointment_notes?: string;
  tip_amount?: number;
};
export default function AppointmentsList() {
  const router = useRouter();
  const { colors } = useAppTheme();
  useFeatureAccess();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<AppointmentTab>("upcoming");
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [clients, setClients] = useState<any[]>([]);

  const [selectedAppointment, setSelectedAppointment] = useState<any | null>(
    null,
  );
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [tipAmount, setTipAmount] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [use24Hour, setUse24Hour] = useState(false);

  useEffect(() => {
    fetchData();
    void loadCalendarPreferences();
  }, []);

  async function loadCalendarPreferences() {
    const preferences = await getCalendarPreferences();
    setUse24Hour(preferences.timeFormat === "24h");
  }

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

  async function fetchData() {
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

    setAppointments(appointmentsResult.data || []);
    setServices(servicesResult.data || []);
    setClients(clientsResult.data || []);
  }

  function getClientByName(name: string) {
    return clients.find((client) => client.name === name);
  }

  function formatLocalDate(date: Date) {
    return (
      `${date.getFullYear()}-` +
      `${String(date.getMonth() + 1).padStart(2, "0")}-` +
      `${String(date.getDate()).padStart(2, "0")}`
    );
  }

  function getRebookDate(appointment: any) {
    const client = getClientByName(appointment.client_name);
    const weeks = Number(client?.rebooking_weeks || 6);

    const [year, month, day] = appointment.appointment_date
      .split("-")
      .map(Number);
    const date = new Date(year, month - 1, day);

    date.setDate(date.getDate() + weeks * 7);

    return formatLocalDate(date);
  }

  function filteredAppointments() {
    if (activeTab === "upcoming") {
      return appointments.filter(
        (a) => (a.status === "scheduled" || !a.status) && !a.archived,
      );
    }

    if (activeTab === "completed") {
      return appointments.filter(
        (a) => a.status === "completed" && !a.archived,
      );
    }

    return appointments.filter(
      (a) =>
        !a.archived &&
        (a.status === "canceled" ||
          a.status === "customer_canceled" ||
          a.status === "business_canceled" ||
          a.status === "no_show"),
    );
  }

  function openAppointment(appointment: any) {
    setSelectedAppointment(appointment);
    setTipAmount(String(appointment.tip_amount ?? ""));
    setAppointmentNotes(appointment.appointment_notes ?? "");
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
      current.map((appointment) =>
        appointment.id === data.id ? data : appointment,
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
        current.map((appointment) =>
          appointment.id === data.id ? data : appointment,
        ),
      );
    }
  }

  async function updateAppointmentStatus(id: string, status: string) {
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
        void sendAppointmentSmsNonBlocking(id, "cancellation");
        await cancelAppointmentReminder(id);
      }

      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === data.id ? data : appointment,
        ),
      );

      if (selectedAppointment?.id === data.id) {
        setSelectedAppointment(data);
      }
    }
  }

  async function deleteAppointment(id: string) {
    await confirmDestructiveAction({
      title: "Delete Appointment",
      message: "Are you sure you want to delete this appointment?",
      confirmText: "Delete",
      onConfirm: async () => {
        const userId = await getCurrentUserIdOrAlert();
        if (!userId) return;

        void sendAppointmentSmsNonBlocking(id, "cancellation");

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

        await Promise.all(
          selectedIds.map((appointmentId) =>
            sendAppointmentSmsNonBlocking(appointmentId, "cancellation"),
          ),
        );

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
    Alert.alert(
      "Schedova Pro",
      "Smart rescheduling and follow-up tools are Pro features.",
    );
  }

  function StatusBadge({ appointment }: { appointment: any }) {
    const status = appointment.status || "scheduled";

    return (
      <View
        style={{
          backgroundColor: colors.background,
          paddingHorizontal: 12,
          paddingVertical: 5,
          borderRadius: 999,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 12, fontWeight: "bold" }}>
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
          backgroundColor: active ? colors.primary : colors.card,
          padding: 12,
          borderRadius: 999,
          alignItems: "center",
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "bold" }}>{label}</Text>
      </Pressable>
    );
  }
  function getAppointmentServices(appointment: any) {
    return getSavedAppointmentServices(appointment, services);
  }
  const shownAppointments = filteredAppointments().slice(0, 50);

  const selectedAppointmentServices = selectedAppointment
    ? getAppointmentServices(selectedAppointment)
    : [];

  const selectedService = selectedAppointmentServices[0] || null;

  const selectedClient = selectedAppointment
    ? getClientByName(selectedAppointment.client_name)
    : null;

  const selectedRebookDate =
    selectedAppointment?.status === "completed"
      ? getRebookDate(selectedAppointment)
      : null;

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Text
        style={{
          fontSize: 28,
          fontWeight: "bold",
          marginBottom: 20,
          color: colors.text,
        }}
      >
        Appointments
      </Text>

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

        return (
          <View
            key={appointment.id}
            style={{
              backgroundColor: colors.card,
              borderLeftWidth: 8,
              borderLeftColor: service?.color_hex || colors.border,
              padding: 18,
              borderRadius: 18,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
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
              {appointment.appointment_date} at {formatTime(appointment.appointment_time)}
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
              <Pressable
                onPress={() => {
                  if (selectedIds.includes(appointment.id)) {
                    setSelectedIds(
                      selectedIds.filter((id) => id !== appointment.id),
                    );
                  } else {
                    setSelectedIds([...selectedIds, appointment.id]);
                  }
                }}
                style={{
                  position: "absolute",
                  top: 14,
                  right: 14,
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  borderWidth: 2,
                  borderColor: "#0F766E",
                  backgroundColor: selectedIds.includes(appointment.id)
                    ? "#0F766E"
                    : "#ffffff",
                  justifyContent: "center",
                  alignItems: "center",
                  zIndex: 10,
                }}
              >
                <Text
                  style={{
                    color: selectedIds.includes(appointment.id)
                      ? "#ffffff"
                      : "#0F766E",
                    fontWeight: "bold",
                  }}
                >
                  ✓
                </Text>
              </Pressable>
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
                canUseFeature("smartReminders") && (
                <Text
                  style={{
                    marginLeft: 14,
                    color: "#0F766E",
                    fontWeight: "bold",
                    fontSize: 13,
                  }}
                >
                  Rebook: {getRebookDate(appointment)}
                </Text>
              )}
            </View>

            <Pressable
              onPress={() => openAppointment(appointment)}
              style={{
                backgroundColor: "#0F766E",
                paddingVertical: 13,
                borderRadius: 999,
                alignItems: "center",
                marginTop: 16,
              }}
            >
              <Text
                style={{ color: "#ffffff", fontWeight: "bold", fontSize: 15 }}
              >
                Edit
              </Text>
            </Pressable>
          </View>
        );
      })}

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
                  const idToEdit = selectedAppointment?.id;

                  if (!idToEdit) {
                    Alert.alert("Error", "No appointment ID found.");
                    return;
                  }

                  setSelectedAppointment(null);

                  router.push({
                    pathname: "/book-appointment",
                    params: {
                      appointmentId: idToEdit,
                      mode: "edit",
                    },
                  });
                }}
                style={{
                  backgroundColor: "#3B82F6",
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
                  borderLeftWidth: 10,
                  borderLeftColor: selectedService?.color_hex || "#0F766E",
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
                  Time: {formatTime(selectedAppointment?.appointment_time)}
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
                        backgroundColor: colors.card,
                        padding: 12,
                        borderRadius: 12,
                        marginTop: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "bold" }}>
                        {status}
                      </Text>
                    </Pressable>
                  ),
                )}

                {selectedAppointment?.status === "completed" &&
                  canUseFeature("smartReminders") && (
                  <View
                    style={{
                      backgroundColor: colors.card,
                      borderColor: colors.border,
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
                        style={{ color: colors.primary, fontWeight: "bold" }}
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
                  borderColor: "#D1D5DB",
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
                  borderColor: "#D1D5DB",
                  borderRadius: 12,
                  padding: 14,
                  minHeight: 110,
                  textAlignVertical: "top",
                  color: colors.text,
                  marginBottom: 10,
                }}
              />

              <Pressable
                onPress={() => deleteAppointment(selectedAppointment.id)}
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
                  backgroundColor: "#0F766E",
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
