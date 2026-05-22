import * as Print from "expo-print";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import {
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { canUseFeature } from "../lib/featureAccess";
import { useAppTheme } from "../lib/useAppTheme";

import { supabase } from "../lib/supabase";

type RangeKey = "today" | "week" | "month" | "three" | "six" | "year";

const RANGES: {
  key: RangeKey;
  label: string;
  days: number;
}[] = [
  { key: "today", label: "Today", days: 1 },
  { key: "week", label: "1 Week", days: 7 },
  { key: "month", label: "1 Month", days: 30 },
  { key: "three", label: "3 Months", days: 90 },
  { key: "six", label: "6 Months", days: 180 },
  { key: "year", label: "End Of Year", days: 365 },
];

export default function ReportsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const reportsAvailable = canUseFeature("reports");
  const [range, setRange] = useState<RangeKey>("today");

  const [appointments, setAppointments] = useState<any[]>([]);

  const [services, setServices] = useState<any[]>([]);

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

  const report = useMemo(() => {
    const selected = RANGES.find((item) => item.key === range) || RANGES[0];

    const end = new Date();
    const start = new Date();

    if (range === "today") {
      start.setHours(0, 0, 0, 0);
    } else {
      start.setDate(end.getDate() - selected.days);

      start.setHours(0, 0, 0, 0);
    }

    const filtered = appointments.filter((appointment) => {
      const date = new Date(`${appointment.appointment_date}T12:00:00`);

      return date >= start && date <= end;
    });

    const completed = filtered.filter((a) => a.status === "completed");

    const cancelled = filtered.filter(
      (a) =>
        a.status === "canceled" ||
        a.status === "customer_canceled" ||
        a.status === "business_canceled",
    );

    const noShows = filtered.filter((a) => a.status === "no_show");

    const upcoming = filtered.filter((a) => a.status === "scheduled");

    let serviceRevenue = 0;
    let tips = 0;

    let card = 0;
    let cash = 0;
    let other = 0;

    const serviceCounts: Record<string, number> = {};

    completed.forEach((appointment) => {
      const appointmentServices = getAppointmentServices(
        appointment,
        services,
      );

      const price =
        appointment.final_price !== null &&
        appointment.final_price !== undefined
          ? Number(appointment.final_price || 0)
          : getAppointmentServiceTotal(appointment, services);

      const tip = Number(appointment.tip_amount || 0);
      const paymentType = appointment.payment_type || "other";

      serviceRevenue += price;
      tips += tip;

      if (paymentType === "card") {
        card += price + tip;
      } else if (paymentType === "cash") {
        cash += price + tip;
      } else {
        other += price + tip;
      }

      appointmentServices.forEach((service: any) => {
        const serviceName = service?.name || "Unknown Service";
        serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
      });
    });

    const topServices = Object.entries(serviceCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      total: filtered.length,
      completed: completed.length,
      cancelled: cancelled.length,
      noShows: noShows.length,
      upcoming: upcoming.length,
      serviceRevenue,
      tips,
      totalRevenue: serviceRevenue + tips,
      card,
      cash,
      other,
      topServices,
    };
  }, [appointments, services, range]);

  async function shareReportPdf() {
    const rangeLabel = RANGES.find((item) => item.key === range)?.label || "";

    const html = `
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h1>Schedova Report</h1>
          <h2>${rangeLabel}</h2>

          <h3>Appointments</h3>
          <p>Total: ${report.total}</p>
          <p>Completed: ${report.completed}</p>
          <p>Upcoming: ${report.upcoming}</p>
          <p>Cancelled: ${report.cancelled}</p>
          <p>No Shows: ${report.noShows}</p>

          <h3>Revenue</h3>
          <p>Total Revenue: $${report.totalRevenue.toFixed(2)}</p>

          <p>Service Revenue: $${report.serviceRevenue.toFixed(2)}</p>

          <p>Tips: $${report.tips.toFixed(2)}</p>

          <h3>Payments</h3>
          <p>Card: $${report.card.toFixed(2)}</p>

          <p>Cash: $${report.cash.toFixed(2)}</p>

          <p>Other: $${report.other.toFixed(2)}</p>

          <h3>Top Services</h3>

          ${
            report.topServices.length === 0
              ? "<p>No completed services.</p>"
              : report.topServices
                  .map(([name, count]) => `<p>${name}: ${count}</p>`)
                  .join("")
          }
        </body>
      </html>
    `;

    const file = await Print.printToFileAsync({
      html,
    });

    await Sharing.shareAsync(file.uri);
  }

  function MoneyCard({ title, amount }: { title: string; amount: number }) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: 16,
          borderRadius: 16,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: colors.text,
            fontSize: 24,
            fontWeight: "bold",
            marginTop: 6,
          }}
        >
          ${amount.toFixed(2)}
        </Text>
      </View>
    );
  }

  function StatCard({ title, value }: { title: string; value: number }) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: 16,
          borderRadius: 16,
          marginBottom: 10,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: colors.text,
            fontSize: 24,
            fontWeight: "bold",
            marginTop: 6,
          }}
        >
          {value}
        </Text>
      </View>
    );
  }

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
          Reports
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 18,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
            Schedova Pro
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8 }}>
            Reports, revenue dashboards, and business insights are Pro features.
          </Text>
        </View>

        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: colors.primary,
            padding: 14,
            borderRadius: 999,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>Back</Text>
        </Pressable>
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
        Reports
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginBottom: 20 }}
      >
        {RANGES.map((item) => {
          const active = range === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() => setRange(item.key)}
              style={{
                backgroundColor: active ? colors.primary : colors.card,
                borderWidth: active ? 0 : 1,
                borderColor: colors.border,
                paddingVertical: 10,
                paddingHorizontal: 16,
                borderRadius: 999,
                marginRight: 10,
              }}
            >
              <Text
                style={{
                  color: colors.text,

                  fontWeight: "bold",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={shareReportPdf}
        style={{
          backgroundColor: colors.primary,
          padding: 16,
          borderRadius: 999,
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
          }}
        >
          Share / Print PDF Report
        </Text>
      </Pressable>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <MoneyCard title="Service Revenue" amount={report.serviceRevenue} />
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <MoneyCard title="Tips" amount={report.tips} />

        <MoneyCard title="Card" amount={report.card} />
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <MoneyCard title="Cash" amount={report.cash} />

        <MoneyCard title="Other" amount={report.other} />
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <StatCard title="Appointments" value={report.total} />

        <StatCard title="Completed" value={report.completed} />
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <StatCard title="Upcoming" value={report.upcoming} />

        <StatCard title="Cancelled" value={report.cancelled} />
      </View>

      <View
        style={{
          flexDirection: "row",
          gap: 10,
        }}
      >
        <StatCard title="No Shows" value={report.noShows} />
      </View>

      <View
        style={{
          backgroundColor: colors.background,
          padding: 15,
          paddingBottom: 20,
          borderRadius: 16,
          marginTop: 10,
          marginBottom: 8,
        }}
      >
        <Text
          style={{
            fontSize: 20,
            fontWeight: "bold",
            color: colors.text,
            marginBottom: 14,
          }}
        >
          Top Services
        </Text>

        {report.topServices.length === 0 && (
          <Text
            style={{
              color: colors.text,
            }}
          >
            No completed services in this range.
          </Text>
        )}

        {report.topServices.map(([name, count]) => (
          <View
            key={name}
            style={{
              flexDirection: "row",
              justifyContent: "space-between",

              paddingVertical: 10,
              borderBottomWidth: 1,
              backgroundColor: colors.card,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "bold",
              }}
            >
              {name}
            </Text>

            <Text
              style={{
                color: colors.text,
                fontWeight: "bold",
              }}
            >
              {count}
            </Text>
          </View>
        ))}
      </View>
      <Pressable
        onPress={() => router.push("/service-reports" as any)}
        style={{
          backgroundColor: colors.primary,
          padding: 14,
          borderRadius: 999,
          alignItems: "center",
          marginTop: 8,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
          }}
        >
          View All Services
        </Text>
      </Pressable>
    </ScrollView>
  );
}
