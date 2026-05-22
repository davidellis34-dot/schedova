import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { normalizeClientTag } from "../lib/clientTags";
import { canUseFeature, FREE_TIER_LIMITS } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function ClientDetailsScreen() {
  const { clientId } = useLocalSearchParams();
  const router = useRouter();
  const { colors } = useAppTheme();
  const [client, setClient] = useState<any | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const clientIdValue = Array.isArray(clientId) ? clientId[0] : clientId;

  const fetchData = useCallback(async () => {
    if (!clientIdValue) return;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) return;

    const clientResult = await supabase
      .from("clients")
      .select("*")
      .eq("id", clientIdValue)
      .eq("user_id", userId)
      .maybeSingle();

    setClient(clientResult.data || null);

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId)
      .order("appointment_date", { ascending: false });

    const servicesResult = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    const clientName = String(clientResult.data?.name || "").trim();
    const matchingAppointments = (appointmentsResult.data || []).filter(
      (appointment: any) =>
        String(appointment.client_id || "") === String(clientIdValue) ||
        (!!clientName && String(appointment.client_name || "") === clientName),
    );

    setAppointments(matchingAppointments);
    setServices(servicesResult.data || []);
  }, [clientIdValue]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

  function getDisplayPrice(appointment: any) {
    if (
      appointment.final_price !== null &&
      appointment.final_price !== undefined
    ) {
      return Number(appointment.final_price || 0);
    }

    return getAppointmentServiceTotal(appointment, services);
  }

  const completedAppointments = appointments.filter(
    (appointment) => appointment.status === "completed",
  );
  const noShows = appointments.filter(
    (appointment) => appointment.status === "no_show",
  );

  const totalSpent = completedAppointments.reduce(
    (total, appointment) =>
      total + getDisplayPrice(appointment) + Number(appointment.tip_amount || 0),
    0,
  );

  const smartRemindersAvailable = canUseFeature("smartReminders");
  const noShowTrackerAvailable = canUseFeature("noShowTracker");
  const revenueAvailable = canUseFeature("revenueInsights");
  const fullHistoryAvailable = canUseFeature("fullClientHistory");

  const suggestedRebookDate = smartRemindersAvailable
    ? getSuggestedRebookDate()
    : null;
  const todayKey = new Date().toISOString().slice(0, 10);
  const pastAppointments = appointments.filter(
    (appointment) =>
      appointment.appointment_date < todayKey ||
      [
        "completed",
        "canceled",
        "cancelled",
        "customer_canceled",
        "customer_cancelled",
        "business_canceled",
        "business_cancelled",
        "no_show",
      ].includes(appointment.status),
  );
  const visiblePastAppointments = fullHistoryAvailable
    ? pastAppointments
    : pastAppointments.slice(0, FREE_TIER_LIMITS.clientHistoryItems);
  const lockedPastAppointmentCount = Math.max(
    pastAppointments.length - visiblePastAppointments.length,
    0,
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}
    >
      <Text style={{ fontSize: 30, fontWeight: "bold", color: colors.text }}>
        {client?.name || "Client"}
      </Text>

      <Text style={{ color: colors.text, marginBottom: 16 }}>
        Client profile and appointment history
      </Text>

      <Pressable
        onPress={() =>
          router.push({
            pathname: "/edit-client",
            params: { clientId: clientIdValue },
          } as any)
        }
        style={{
          backgroundColor: colors.primary,
          padding: 14,
          borderRadius: 12,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          Edit Client
        </Text>
      </Pressable>

      <View
        style={{
          backgroundColor: colors.card,
          padding: 18,
          borderRadius: 16,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
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
          Tag: {normalizeClientTag(client?.client_tag)}
        </Text>

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

        {!smartRemindersAvailable ? (
          <Text style={{ color: colors.mutedText, marginTop: 6 }}>
            Smart rebooking reminders: Pro
          </Text>
        ) : null}

        {noShowTrackerAvailable ? (
          <Text style={{ color: colors.text, marginTop: 6 }}>
            No-Shows: {client?.no_show_count || noShows.length}
          </Text>
        ) : (
          <Text style={{ color: colors.mutedText, marginTop: 6 }}>
            No-show tracker: Pro
          </Text>
        )}

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

        {revenueAvailable ? (
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
              ${totalSpent.toFixed(2)}
            </Text>
            <Text style={{ color: colors.text }}>Total Spent</Text>
          </View>
        ) : (
          <View
            style={{
              flex: 1,
              backgroundColor: colors.card,
              padding: 16,
              borderRadius: 14,
            }}
          >
            <Text
              style={{ fontSize: 18, fontWeight: "900", color: colors.text }}
            >
              Pro
            </Text>
            <Text style={{ color: colors.mutedText }}>Client value insights</Text>
          </View>
        )}
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 14,
          color: colors.text,
        }}
      >
        Past Appointments
      </Text>

      {pastAppointments.length === 0 ? (
        <Text style={{ color: colors.mutedText }}>
          No past appointments yet.
        </Text>
      ) : null}

      {visiblePastAppointments.map((appointment) => {
        const appointmentServices = getAppointmentServices(
          appointment,
          services,
        );
        const serviceNames = appointmentServices
          .map((service) => service.name)
          .filter(Boolean)
          .join(", ");
        const servicePrice = getDisplayPrice(appointment);

        return (
          <View
            key={appointment.id}
            style={{
              backgroundColor: colors.card,
              padding: 16,
              borderRadius: 14,
              marginBottom: 12,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "900" }}>
              {appointment.appointment_date}
            </Text>
            <Text style={{ color: colors.text, marginTop: 6 }}>
              {serviceNames || "No service selected"}
            </Text>
            <Text style={{ color: colors.text, marginTop: 6 }}>
              ${servicePrice.toFixed(2)} - {appointment.status || "scheduled"}
            </Text>
          </View>
        );
      })}

      {lockedPastAppointmentCount > 0 ? (
        <View
          style={{
            backgroundColor: colors.card,
            padding: 16,
            borderRadius: 14,
            marginBottom: 12,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.text, fontWeight: "900" }}>
            Schedova Pro
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 6 }}>
            {lockedPastAppointmentCount} older appointment
            {lockedPastAppointmentCount === 1 ? "" : "s"} are locked on Free.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}
