import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { supabase } from "../../lib/supabase";
export default function ServiceReportsScreen() {
  const [appointments, setAppointments] = useState<any[]>([]);

  const [services, setServices] = useState<any[]>([]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
    }, []),
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
      const serviceAppointments = appointments.filter(
        (appointment) => appointment.service_id === service.id,
      );

      const completed = serviceAppointments.filter(
        (appointment) => appointment.status === "completed",
      );

      const cancelled = serviceAppointments.filter(
        (appointment) =>
          appointment.status === "cancelled" ||
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

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: "#ffffff",
        padding: 20,
      }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          color: "#111111",
          marginBottom: 20,
        }}
      >
        Service Reports
      </Text>

      {serviceStats.length === 0 && (
        <Text
          style={{
            color: "#666666",
          }}
        >
          No services yet.
        </Text>
      )}

      {serviceStats.map((service) => (
        <View
          key={service.id}
          style={{
            backgroundColor: "#F3F4F6",
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
              color: "#111111",
            }}
          >
            {service.name}
          </Text>

          <Text
            style={{
              marginTop: 6,
              color: "#555555",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                Booked
              </Text>

              <Text
                style={{
                  color: "#111111",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                Revenue
              </Text>

              <Text
                style={{
                  color: "#111111",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                Avg Tip
              </Text>

              <Text
                style={{
                  color: "#111111",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                Completed
              </Text>

              <Text
                style={{
                  color: "#111111",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                Cancelled
              </Text>

              <Text
                style={{
                  color: "#111111",
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
                backgroundColor: "#ffffff",
                padding: 14,
                borderRadius: 14,
              }}
            >
              <Text
                style={{
                  color: "#555555",
                  fontWeight: "bold",
                }}
              >
                No Shows
              </Text>

              <Text
                style={{
                  color: "#111111",
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
