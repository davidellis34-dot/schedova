import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function ClientDetailsScreen() {
  const { clientId } = useLocalSearchParams();
  const { colors } = useAppTheme();
  const [client, setClient] = useState<any | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    const clientResult = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientId)
      .single();

    setClient(clientResult.data || null);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .eq("client_name", clientResult.data?.name)
      .order("appointment_date", { ascending: false });

    const servicesResult = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    setAppointments(appointmentsResult.data || []);
    setServices(servicesResult.data || []);
  }

  function getService(serviceId: string) {
    return services.find((service) => service.id === serviceId);
  }

  function getSuggestedRebookDate() {
    const completed = appointments.filter((a) => a.status === "completed");

    if (completed.length === 0) return null;

    const lastCompleted = completed[0];
    const weeks = Number(client?.rebooking_weeks || 6);
    const [year, month, day] = lastCompleted.appointment_date
      .split("-")
      .map(Number);

    const rebookDate = new Date(year, month - 1, day);

    rebookDate.setDate(rebookDate.getDate() + weeks * 7);

    return rebookDate.toISOString().split("T")[0];
  }

  const completedAppointments = appointments.filter(
    (a) => a.status === "completed",
  );
  const noShows = appointments.filter((a) => a.status === "no_show");

  const totalSpent = completedAppointments.reduce((total, appointment) => {
    const service = getService(appointment.service_id);
    return (
      total + Number(service?.price || 0) + Number(appointment.tip_amount || 0)
    );
  }, 0);

  const suggestedRebookDate = getSuggestedRebookDate();

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}
    >
      <Text style={{ fontSize: 30, fontWeight: "bold", color: colors.text }}>
        {client?.name || "Client"}
      </Text>

      <Text style={{ color: colors.text, marginBottom: 20 }}>
        Client history and timeline
      </Text>

      <View
        style={{
          backgroundColor: colors.background,
          padding: 18,
          borderRadius: 16,
          marginBottom: 20,
        }}
      >
        {!!client?.phone && (
          <Text style={{ color: colors.text }}>Phone: {client.phone}</Text>
        )}
        {!!client?.email && (
          <Text style={{ color: colors.text }}>Email: {client.email}</Text>
        )}
        {!!client?.birthday && (
          <Text style={{ color: colors.text }}>
            Birthday: {client.birthday}
          </Text>
        )}

        <Text style={{ color: colors.text, marginTop: 6 }}>
          Rebooking Every: {client?.rebooking_weeks || 6} weeks
        </Text>

        {!!suggestedRebookDate && (
          <Text
            style={{ color: colors.text, marginTop: 6, fontWeight: "bold" }}
          >
            Suggested Rebook: {suggestedRebookDate}
          </Text>
        )}

        <Text style={{ color: colors.text, marginTop: 6 }}>
          No-Shows: {client?.no_show_count || noShows.length}
        </Text>

        {!!client?.notes && (
          <Text style={{ color: colors.text, marginTop: 8 }}>
            Notes: {client.notes}
          </Text>
        )}
      </View>

      <View style={{ flexDirection: "row", marginBottom: 24 }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.card,
            padding: 16,
            borderRadius: 14,
          }}
        >
          <Text
            style={{ fontSize: 24, fontWeight: "bold", color: colors.text }}
          >
            {appointments.length}
          </Text>
          <Text style={{ color: colors.text }}>Total Visits</Text>
        </View>

        <View style={{ width: 10 }} />

        <View
          style={{
            flex: 1,
            backgroundColor: colors.card,
            padding: 16,
            borderRadius: 14,
          }}
        >
          <Text
            style={{ fontSize: 24, fontWeight: "bold", color: colors.text }}
          >
            ${totalSpent}
          </Text>
          <Text style={{ color: colors.text }}>Total Spent</Text>
        </View>
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 14,
          color: colors.text,
        }}
      >
        Timeline
      </Text>

      {appointments.map((appointment) => {
        const service = getService(appointment.service_id);
        const servicePrice = Number(service?.price || 0);
        const tip = Number(appointment.tip_amount || 0);
        const total =
          appointment.status === "completed" ? servicePrice + tip : 0;

        return (
          <View
            key={appointment.id}
            style={{ flexDirection: "row", marginBottom: 16 }}
          >
            <View style={{ width: 18, alignItems: "center" }}>
              <View
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: colors.card,
                  marginTop: 8,
                }}
              />
              <View
                style={{
                  flex: 1,
                  width: 2,
                  backgroundColor: colors.card,
                  marginTop: 4,
                }}
              />
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 16,
                borderRadius: 14,
                marginLeft: 10,
              }}
            >
              <Text
                style={{ fontSize: 17, fontWeight: "bold", color: "#111111" }}
              >
                {appointment.appointment_date} · {appointment.appointment_time}
              </Text>

              <Text style={{ color: colors.text, marginTop: 6 }}>
                {service?.name || "No service selected"}
              </Text>

              <Text style={{ color: colors.text, marginTop: 4 }}>
                Status: {appointment.status}
              </Text>

              {appointment.status === "completed" && (
                <Text
                  style={{
                    color: colors.text,
                    marginTop: 6,
                    fontWeight: "bold",
                  }}
                >
                  Service ${servicePrice} + Tip ${tip} = ${total}
                </Text>
              )}

              {!!appointment.appointment_notes && (
                <View
                  style={{
                    backgroundColor: colors.card,
                    padding: 12,
                    borderRadius: 10,
                    marginTop: 10,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: "bold",
                      color: colors.text,
                      marginBottom: 4,
                    }}
                  >
                    Notes
                  </Text>
                  <Text style={{ color: colors.text }}>
                    {appointment.appointment_notes}
                  </Text>
                </View>
              )}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}
