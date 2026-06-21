import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import {
  getAppointmentServices as getSavedAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { formatClockTime, getCalendarPreferences } from "../lib/calendarPreferences";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function Dashboard() {
  const router = useRouter();
  const { colors } = useAppTheme();
  useFeatureAccess();
  function getClientDisplayName(appointment: any) {
    const appointmentName = String(appointment?.client_name || "").trim();

    if (appointmentName && appointmentName !== "New Client") {
      return appointmentName;
    }

    const matchedClient = clients.find(
      (client) => String(client.id) === String(appointment.client_id),
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

  async function fetchClients() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setClients([]);
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.log("🔥 FETCH CLIENTS ERROR:", error.message);
      setClients([]);
      return;
    }

    setClients(data || []);
  }
  async function loadFontScale() {
    const savedFont = await AsyncStorage.getItem("font_scale");
    setFontScale(savedFont || "normal");
  }

  async function loadCalendarDisplayPreferences() {
    const preferences = await getCalendarPreferences();
    setUse24Hour(preferences.timeFormat === "24h");
  }

  function getFontSize(base: number) {
    if (fontScale === "small") return base - 2;
    if (fontScale === "large") return base + 3;
    return base;
  }

  const checkBusiness = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    setUserEmail(userData.user?.email || "");

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
      console.log("🔥 CHECK BUSINESS ERROR:", error.message);
      setHasBusiness(false);
      return;
    }

    setHasBusiness((data || []).length > 0);
  }, [router]);

  useFocusEffect(
    useCallback(() => {
      loadFontScale();
      void loadCalendarDisplayPreferences();
      checkBusiness();
      fetchAppointments();
      fetchServices();
      fetchClients();
    }, [checkBusiness]),
  );

  async function fetchAppointments() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    setUserEmail(userData.user?.email || "");

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
      console.log("🔥 FETCH APPOINTMENTS ERROR:", error.message);
      setAppointments([]);
      return;
    }

    setAppointments(data || []);
  }

  async function fetchServices() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setServices([]);
      return;
    }

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    if (error) {
      console.log("🔥 FETCH SERVICES ERROR:", error.message);
      setServices([]);
      return;
    }

    setServices(data || []);
  }

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

        await sendAppointmentSmsNonBlocking(id, "cancellation");

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
      void sendAppointmentSmsNonBlocking(
        selectedStatusAppointment.id,
        "cancellation",
      );
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

  function getStatusColor(status?: string | null) {
    if (status === "completed") return "#15803D";
    if (status === "canceled") return "#991B1B";
    if (status === "no_show") return "#C2410C";
    return "#0F766E";
  }

  function openAppointmentEdit(appointment: any) {
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

  const todaysAppointments = appointments.filter(
    (appointment) =>
      appointment.appointment_date === todayIso &&
      appointment.status !== "canceled",
  );

  const upcomingAppointments = appointments
    .filter(
      (appointment) =>
        appointment.appointment_date >= todayIso &&
        appointment.status !== "canceled",
    )
    .slice(0, 5);

  const revenueAvailable = canUseFeature("revenueInsights");

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
  const monthAppointments = appointments.filter(
    (appointment) =>
      String(appointment.appointment_date || "").startsWith(currentMonth) &&
      appointment.status !== "canceled",
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
  function MainButton({
    title,
    subtitle,
    icon,
    color,
    route,
  }: {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    route: string;
  }) {
    return (
      <Pressable
        onPress={() => router.push(route as any)}
        style={{
          backgroundColor: color,
          paddingVertical: 18,
          paddingHorizontal: 14,
          borderRadius: 18,
          flex: 1,
          minHeight: 118,
          justifyContent: "space-between",
          shadowColor: color,
          shadowOffset: { width: 0, height: 5 },
          shadowOpacity: 0.18,
          shadowRadius: 10,
          elevation: 4,
        }}
      >
        <Ionicons name={icon} size={26} color="#FFFFFF" />

        <View>
          <Text
            style={{
              color: "#FFFFFF",
              fontSize: getFontSize(17),
              fontWeight: "bold",
            }}
          >
            {title}
          </Text>

          <Text
            style={{
              color: "rgba(255,255,255,0.86)",
              fontSize: getFontSize(13),
              marginTop: 4,
            }}
          >
            {subtitle}
          </Text>
        </View>
      </Pressable>
    );
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text
            style={{
              fontSize: getFontSize(38),
              fontWeight: "bold",
              color: colors.text,
            }}
          >
            Schedova
          </Text>

          <Text style={{ color: colors.mutedText, marginBottom: 12 }}>
            {userEmail ? `Signed in as: ${userEmail}` : "Signed in"}
          </Text>

          <Text
            style={{
              fontSize: getFontSize(15),
              color: colors.mutedText,
              marginTop: 4,
            }}
          >
            Book clients, manage services, and keep your day organized.
          </Text>
        </View>

        <Pressable onPress={() => router.push("/settings" as any)}>
          <Ionicons name="settings-outline" size={30} color={colors.text} />
        </Pressable>
      </View>

      {hasBusiness === false ? (
        <Pressable
          onPress={() => router.push("/business-setup" as any)}
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 16,
            marginTop: 18,
            marginBottom: 22,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontWeight: "bold",
              fontSize: getFontSize(17),
              marginBottom: 4,
            }}
          >
            Set up your business
          </Text>

          <Text
            style={{
              color: colors.mutedText,
              fontSize: getFontSize(14),
            }}
          >
            Add your business info to personalize your schedule.
          </Text>
        </Pressable>
      ) : null}

      <Text
        style={{
          color: colors.text,
          fontSize: getFontSize(20),
          fontWeight: "bold",
          marginTop: 24,
          marginBottom: 14,
        }}
      >
        Quick Actions
      </Text>

      <View style={{ marginBottom: 24 }}>
        <View
          style={{
            flexDirection: "row",
            marginBottom: 12,
          }}
        >
          <MainButton
            title="Book"
            subtitle="Add appointment"
            icon="calendar-outline"
            color="#0F766E"
            route="/book-appointment"
          />

          <View style={{ width: 12 }} />

          <MainButton
            title="Clients"
            subtitle="Manage people"
            icon="people-outline"
            color="#2563EB"
            route="/clients"
          />
        </View>

        <View
          style={{
            flexDirection: "row",
          }}
        >
          <MainButton
            title="Services"
            subtitle="Prices & duration"
            icon="briefcase-outline"
            color="#7C3AED"
            route="/add-service"
          />

          <View style={{ width: 12 }} />

          <MainButton
            title="Calendar"
            subtitle="Week view"
            icon="grid-outline"
            color="#EA580C"
            route="/calendar-view"
          />
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          padding: 18,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(20),
            fontWeight: "bold",
            marginBottom: 14,
          }}
        >
          This Month
        </Text>

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
              }}
            >
              Appointments
            </Text>

            <Text
              style={{
                color: colors.text,
                fontSize: getFontSize(30),
                fontWeight: "bold",
                marginTop: 4,
              }}
            >
              {monthAppointments.length}
            </Text>
          </View>

          {revenueAvailable ? (
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: getFontSize(13),
                  textAlign: "right",
                }}
              >
                Expected Revenue
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: getFontSize(30),
                  fontWeight: "bold",
                  marginTop: 4,
                  textAlign: "right",
                }}
              >
                ${monthExpectedRevenue.toFixed(2)}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: getFontSize(13),
                  textAlign: "right",
                }}
              >
                Revenue Insights
              </Text>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  marginTop: 8,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  Pro
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          padding: 18,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(20),
            fontWeight: "bold",
            marginBottom: 14,
          }}
        >
          Today
        </Text>

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
              }}
            >
              Appointments
            </Text>

            <Text
              style={{
                color: colors.text,
                fontSize: getFontSize(30),
                fontWeight: "bold",
                marginTop: 4,
              }}
            >
              {todaysAppointments.length}
            </Text>
          </View>

          {revenueAvailable ? (
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: getFontSize(13),
                  textAlign: "right",
                }}
              >
                Estimated Revenue
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: getFontSize(30),
                  fontWeight: "bold",
                  marginTop: 4,
                  textAlign: "right",
                }}
              >
                ${estimatedRevenue.toFixed(2)}
              </Text>
            </View>
          ) : (
            <View style={{ flex: 1, alignItems: "flex-end" }}>
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: getFontSize(13),
                  textAlign: "right",
                }}
              >
                Expected Revenue
              </Text>

              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 999,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  marginTop: 8,
                }}
              >
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  Pro
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          padding: 18,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: getFontSize(20),
            fontWeight: "bold",
            marginBottom: 14,
          }}
        >
          Upcoming Appointments
        </Text>

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
          upcomingAppointments.map((appointment) => {
            const appointmentServices = getAppointmentServices(appointment);

            const totalDuration = appointmentServices.reduce(
              (sum: number, service: any) =>
                sum + Number(service.duration_minutes || 0),
              0,
            );

            const totalPrice =
              appointment.final_price !== null &&
              appointment.final_price !== undefined
                ? Number(appointment.final_price || 0)
                : appointmentServices.reduce(
                    (sum: number, service: any) =>
                      sum + Number(service.price || 0),
                    0,
                  );

            return (
              <View key={appointment.id}>
                <Pressable
                  onPress={() => openAppointmentEdit(appointment)}
                  style={{
                    backgroundColor: colors.background,
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 12,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: getFontSize(16),
                      fontWeight: "bold",
                    }}
                  >
                    {getClientDisplayName(appointment)}
                  </Text>

                  <Text
                    style={{
                      color: colors.mutedText,
                      fontSize: getFontSize(14),
                      marginTop: 4,
                    }}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                  >
                    {getServiceSummary(
                      appointmentServices
                        .map((service: any) => service.name)
                        .filter(Boolean),
                    )}
                  </Text>

                  <Text
                    style={{
                      color: colors.mutedText,
                      fontSize: getFontSize(14),
                      fontWeight: "600",
                      marginTop: 4,
                    }}
                  >
                    {totalDuration} min • ${totalPrice}
                  </Text>

                  <View
                    style={{
                      alignSelf: "flex-start",
                      backgroundColor: getStatusColor(appointment.status),
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      marginTop: 8,
                      marginBottom: 6,
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontSize: getFontSize(12),
                        fontWeight: "bold",
                      }}
                    >
                      {(appointment.status || "scheduled")
                        .replace("_", " ")
                        .toUpperCase()}
                    </Text>
                  </View>

                  <Text
                    style={{
                      color: colors.mutedText,
                      fontSize: getFontSize(14),
                      marginTop: 6,
                    }}
                  >
                    🕒 {formatTime(appointment.appointment_time)} •{" "}
                    {formatDate(appointment.appointment_date)}
                  </Text>

                  {appointment.appointment_notes ? (
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: getFontSize(13),
                        marginTop: 8,
                      }}
                      numberOfLines={2}
                    >
                      {appointment.appointment_notes}
                    </Text>
                  ) : null}
                </Pressable>

                <View
                  style={{
                    flexDirection: "row",
                    gap: 8,
                    marginBottom: 12,
                    marginTop: 0,
                  }}
                >
                  <Pressable
                    onPress={() => openAppointmentEdit(appointment)}
                    style={{
                      flex: 1,
                      backgroundColor: "#2563EB",
                      paddingVertical: 10,
                      borderRadius: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "bold",
                        fontSize: getFontSize(13),
                      }}
                    >
                      Edit
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      setSelectedStatusAppointment(appointment);
                      setStatusModalOpen(true);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                      paddingVertical: 10,
                      borderRadius: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: colors.text,
                        fontWeight: "bold",
                        fontSize: getFontSize(13),
                      }}
                    >
                      Status
                    </Text>
                  </Pressable>

                  <Pressable
                    onPress={() => {
                      void deleteAppointment(appointment.id);
                    }}
                    style={{
                      flex: 1,
                      backgroundColor: "#DC2626",
                      paddingVertical: 10,
                      borderRadius: 12,
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: "#FFFFFF",
                        fontWeight: "bold",
                        fontSize: getFontSize(13),
                      }}
                    >
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </View>
            );
          })
        )}
      </View>

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
                fontWeight: "bold",
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
              <Text style={{ color: colors.mutedText, fontSize: 18 }}>✕</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                await updateAppointmentStatus("completed");
              }}
              style={{
                backgroundColor: "#16A34A",
                padding: 15,
                borderRadius: 14,
                marginBottom: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold" }}>
                Completed
              </Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                await updateAppointmentStatus("no_show");
              }}
              style={{
                backgroundColor: "#D97706",
                padding: 15,
                borderRadius: 14,
                marginBottom: 10,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold" }}>No Show</Text>
            </Pressable>

            <Pressable
              onPress={async () => {
                await updateAppointmentStatus("canceled");
              }}
              style={{
                backgroundColor: "#DC2626",
                padding: 15,
                borderRadius: 14,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "#fff", fontWeight: "bold" }}>
                Canceled
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </AppScreen>
  );
}
