import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function Dashboard() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [fontScale, setFontScale] = useState("normal");
  const [hasBusiness, setHasBusiness] = useState<boolean | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadFontScale();
      checkBusiness();
      fetchAppointments();
      fetchServices();
    }, []),
  );

  async function loadFontScale() {
    const savedFont = await AsyncStorage.getItem("font_scale");
    setFontScale(savedFont || "normal");
  }

  function getFontSize(base: number) {
    if (fontScale === "small") return base - 2;
    if (fontScale === "large") return base + 3;
    return base;
  }

  async function checkBusiness() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setHasBusiness(false);
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
  }

  async function fetchAppointments() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

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

  function getService(serviceId?: string | null) {
    if (!serviceId) return null;
    return services.find((service) => service.id === serviceId) || null;
  }

  function formatDate(dateString?: string | null) {
    if (!dateString) return "";
    const date = new Date(`${dateString}T12:00:00`);
    return `${date.getMonth() + 1}/${date.getDate()}`;
  }

  function formatTime(timeString?: string | null) {
    if (!timeString) return "";

    const [hourText, minuteText] = String(timeString).split(":");
    let hour = Number(hourText);
    const minute = minuteText || "00";

    if (Number.isNaN(hour)) return "";

    const ampm = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;

    return `${hour}:${minute} ${ampm}`;
  }

  function getStatusColor(status?: string | null) {
    if (status === "completed") return "#15803D";
    if (status === "canceled") return "#991B1B";
    if (status === "no-show") return "#C2410C";
    return "#0F766E";
  }

  const todayIso = new Date().toISOString().split("T")[0];

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

  const estimatedRevenue = todaysAppointments.reduce((total, appointment) => {
    const service = getService(appointment.service_id);
    return total + Number(service?.price || appointment.final_price || 0);
  }, 0);

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
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
      }}
      contentContainerStyle={{
        padding: 20,
        paddingBottom: 40,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 24,
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

          <Text
            style={{
              fontSize: getFontSize(15),
              color: colors.mutedText,
              marginTop: 4,
            }}
          >
            Smart scheduling for service businesses.
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
              ${estimatedRevenue}
            </Text>
          </View>
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
            const service = getService(appointment.service_id);

            return (
              <Pressable
                key={appointment.id}
                onPress={() =>
                  router.push({
                    pathname: "/book-appointment",
                    params: {
                      appointmentId: appointment.id,
                      editMode: "true",
                    },
                  } as any)
                }
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
                  {appointment.client_name || "Appointment"}
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
                    {(appointment.status || "scheduled").toUpperCase()}
                  </Text>
                </View>

                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: getFontSize(14),
                    marginTop: 4,
                  }}
                >
                  {service?.name || "Service"} ·{" "}
                  {formatDate(appointment.appointment_date)} at{" "}
                  {formatTime(appointment.appointment_time)}
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
            );
          })
        )}
      </View>
    </ScrollView>
  );
}
