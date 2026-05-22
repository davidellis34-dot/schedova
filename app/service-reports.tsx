import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { canUseFeature } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function ServiceReportsScreen() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const { colors } = useAppTheme();
  const [services, setServices] = useState<any[]>([]);
  const reportsAvailable = canUseFeature("reports");

  useFocusEffect(
    useCallback(() => {
      if (!reportsAvailable) return;
      fetchData();
    }, [reportsAvailable]),
  );

  async function fetchData() {
    const { data: userData } = await supabase.auth.getUser();

    const userId = userData.user?.id;

    if (!userId) return;

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", userId);

    const servicesResult = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId);

    setAppointments(appointmentsResult.data || []);

    setServices(servicesResult.data || []);
  }

  const serviceStats = useMemo(() => {
    return services.map((service) => {
      const serviceAppointments = appointments.filter((appointment) => {
        const ids = Array.isArray(appointment.service_ids)
          ? appointment.service_ids
          : appointment.service_id
            ? [appointment.service_id]
            : [];

        return ids.map(String).includes(String(service.id));
      });

      const completed = serviceAppointments.filter(
        (appointment) => appointment.status === "completed",
      );

      const cancelled = serviceAppointments.filter(
        (appointment) =>
          appointment.status === "canceled" ||
          appointment.status === "customer_cancelled" ||
          appointment.status === "business_cancelled",
      );

      const noShows = serviceAppointments.filter(
        (appointment) => appointment.status === "no_show",
      );

      const revenue = completed.length * Number(service.price || 0);

      const totalTips = completed.reduce(
        (sum, appointment) => sum + Number(appointment.tip_amount || 0),
        0,
      );

      const averageTip =
        completed.length > 0 ? totalTips / completed.length : 0;

      return {
        ...service,
        booked: serviceAppointments.length,
        completed: completed.length,
        cancelled: cancelled.length,
        noShows: noShows.length,
        revenue,
        averageTip,
      };
    });
  }, [appointments, services]);

  if (!reportsAvailable) {
    return (
      <ScrollView
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: 20,
        }}
      >
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            color: colors.text,
            marginBottom: 20,
          }}
        >
          Service Reports
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 18,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
            Schedova Pro
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8 }}>
            Service reports and revenue insights are Pro features.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        padding: 20,
      }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          color: colors.text,
          marginBottom: 20,
        }}
      >
        Service Reports
      </Text>

      {serviceStats.length === 0 && (
        <Text
          style={{
            color: colors.text,
          }}
        >
          No services yet.
        </Text>
      )}

      {serviceStats.map((service) => (
        <View
          key={service.id}
          style={{
            backgroundColor: colors.card,
            borderLeftWidth: 8,
            borderLeftColor: service.color_hex || "#0F766E",

            padding: 18,
            borderRadius: 18,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              fontSize: 22,
              fontWeight: "bold",
              color: colors.text,
            }}
          >
            {service.name}
          </Text>

          <Text
            style={{
              marginTop: 6,
              color: colors.text,
            }}
          >
            Price: ${Number(service.price || 0).toFixed(2)}
          </Text>

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 16,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                Booked
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                {service.booked}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                Revenue
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                ${service.revenue.toFixed(2)}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 10,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                Avg Tip
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                ${service.averageTip.toFixed(2)}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                Completed
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                {service.completed}
              </Text>
            </View>
          </View>

          <View
            style={{
              flexDirection: "row",
              gap: 10,
              marginTop: 10,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                Cancelled
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                {service.cancelled}
              </Text>
            </View>

            <View
              style={{
                flex: 1,
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "bold",
                }}
              >
                No Shows
              </Text>

              <Text
                style={{
                  color: colors.text,
                  fontSize: 22,
                  fontWeight: "bold",
                  marginTop: 4,
                }}
              >
                {service.noShows}
              </Text>
            </View>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
