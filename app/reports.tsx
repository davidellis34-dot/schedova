import { Ionicons } from "@expo/vector-icons";
import * as Print from "expo-print";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import {
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { openSchedovaProScreen, PRO_UPSELL_COPY } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type RangeKey = "week" | "month" | "last30" | "all";

type RangeBounds = {
  start: Date | null;
  end: Date | null;
};

type TopService = {
  id: string;
  name: string;
  count: number;
  revenue: number;
  percent: number;
};

type RecentActivity = {
  id: string;
  clientName: string;
  dateLabel: string;
  statusLabel: string;
  price: number;
};

type MetricIcon = keyof typeof Ionicons.glyphMap;

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last30", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

function formatCurrency(value: number) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseAppointmentDate(appointment: any) {
  const date = String(appointment?.appointment_date || "");
  const time = String(appointment?.appointment_time || "12:00").slice(0, 5);
  const parsed = new Date(`${date}T${time || "12:00"}:00`);

  if (Number.isNaN(parsed.getTime())) {
    return new Date(`${date}T12:00:00`);
  }

  return parsed;
}

function getRangeBounds(range: RangeKey): RangeBounds {
  const now = new Date();

  if (range === "all") {
    return { start: null, end: null };
  }

  const start = new Date(now);
  const end = new Date(now);

  if (range === "week") {
    start.setDate(start.getDate() - start.getDay());
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (range === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
  } else {
    start.setDate(start.getDate() - 30);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

function isCanceledStatus(status: string | null | undefined) {
  return [
    "canceled",
    "cancelled",
    "customer_canceled",
    "customer_cancelled",
    "business_canceled",
    "business_cancelled",
  ].includes(String(status || ""));
}

function isUpcomingStatus(status: string | null | undefined) {
  const normalizedStatus = String(status || "scheduled");
  return normalizedStatus === "scheduled" || normalizedStatus === "confirmed";
}

function getStatusLabel(status: string | null | undefined) {
  if (status === "completed") return "Completed";
  if (status === "confirmed") return "Confirmed";
  if (status === "no_show") return "No-show";
  if (isCanceledStatus(status)) return "Canceled";
  if (isUpcomingStatus(status)) return "Scheduled";
  return "Appointment";
}

function getAppointmentPrice(appointment: any, services: any[]) {
  if (
    appointment.final_price !== null &&
    appointment.final_price !== undefined &&
    appointment.final_price !== ""
  ) {
    const finalPrice = Number(appointment.final_price);
    return Number.isFinite(finalPrice) ? finalPrice : 0;
  }

  return getAppointmentServiceTotal(appointment, services);
}

function getClientKey(appointment: any) {
  return String(
    appointment.client_id || appointment.client_name || appointment.id || "",
  );
}

function getClientName(appointment: any) {
  return String(appointment.client_name || "Client");
}

function formatActivityDate(appointment: any) {
  const date = parseAppointmentDate(appointment);

  if (Number.isNaN(date.getTime())) return "Date not set";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isArchivedAppointment(appointment: any) {
  return Boolean(appointment.archived || appointment.archived_at);
}

function getRangeLabel(range: RangeKey) {
  return RANGES.find((item) => item.key === range)?.label || "Selected range";
}

export default function ReportsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  useFeatureAccess();
  const reportsAvailable = canUseFeature("reports");
  const [range, setRange] = useState<RangeKey>("month");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      setLoading(false);
      return;
    }

    try {
      const [appointmentsResult, servicesResult] = await Promise.all([
        supabase.from("appointments").select("*").eq("user_id", userId),
        supabase.from("services").select("*").eq("user_id", userId),
      ]);

      if (appointmentsResult.error || servicesResult.error) {
        throw appointmentsResult.error || servicesResult.error;
      }

      setAppointments(appointmentsResult.data || []);
      setServices(servicesResult.data || []);
    } catch (error) {
      console.log("Reports load failed", error);
      setLoadError(true);
      setAppointments([]);
      setServices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!reportsAvailable) return;
      void fetchData();
    }, [fetchData, reportsAvailable]),
  );

  const report = useMemo(() => {
    const { start, end } = getRangeBounds(range);
    const now = Date.now();

    const filtered = appointments
      .filter((appointment) => !isArchivedAppointment(appointment))
      .filter((appointment) => {
        const date = parseAppointmentDate(appointment);
        if (Number.isNaN(date.getTime())) return false;
        return (!start || date >= start) && (!end || date <= end);
      });

    const completed = filtered.filter(
      (appointment) => appointment.status === "completed",
    );
    const canceled = filtered.filter((appointment) =>
      isCanceledStatus(appointment.status),
    );
    const upcoming = filtered.filter((appointment) => {
      const appointmentTime = parseAppointmentDate(appointment).getTime();
      return (
        Number.isFinite(appointmentTime) &&
        appointmentTime >= now &&
        isUpcomingStatus(appointment.status)
      );
    });
    const clients = new Set(
      filtered.map(getClientKey).filter((value) => value.length > 0),
    );
    const serviceTotals = new Map<string, TopService>();

    const revenue = completed.reduce(
      (sum, appointment) => sum + getAppointmentPrice(appointment, services),
      0,
    );
    const tips = filtered.reduce(
      (sum, appointment) => sum + Number(appointment.tip_amount || 0),
      0,
    );

    filtered.forEach((appointment) => {
      const appointmentServices = getAppointmentServices(
        appointment,
        services,
      );

      if (appointmentServices.length === 0) return;

      const appointmentPrice =
        appointment.status === "completed"
          ? getAppointmentPrice(appointment, services)
          : 0;
      const servicePriceTotal = getAppointmentServiceTotal(
        appointment,
        services,
      );

      appointmentServices.forEach((service) => {
        const serviceId = String(service.id || service.name);
        const existing = serviceTotals.get(serviceId) || {
          id: serviceId,
          name: service.name || "Unknown Service",
          count: 0,
          revenue: 0,
          percent: 0,
        };
        const servicePrice = Number(service.price || 0);
        const revenueShare =
          appointment.status === "completed"
            ? servicePriceTotal > 0
              ? appointmentPrice * (servicePrice / servicePriceTotal)
              : appointmentPrice / appointmentServices.length
            : 0;

        existing.count += 1;
        existing.revenue += Number.isFinite(revenueShare) ? revenueShare : 0;
        serviceTotals.set(serviceId, existing);
      });
    });

    const maxServiceCount = Math.max(
      1,
      ...Array.from(serviceTotals.values()).map((service) => service.count),
    );

    const topServices = Array.from(serviceTotals.values())
      .sort((a, b) => b.count - a.count || b.revenue - a.revenue)
      .slice(0, 5)
      .map((service) => ({
        ...service,
        percent: Math.round((service.count / maxServiceCount) * 100),
      }));

    const recentActivity: RecentActivity[] = [...filtered]
      .sort(
        (a, b) =>
          parseAppointmentDate(b).getTime() -
          parseAppointmentDate(a).getTime(),
      )
      .slice(0, 5)
      .map((appointment) => ({
        id: String(appointment.id),
        clientName: getClientName(appointment),
        dateLabel: formatActivityDate(appointment),
        statusLabel: getStatusLabel(appointment.status),
        price: getAppointmentPrice(appointment, services),
      }));

    return {
      appointments: filtered.length,
      revenue,
      tips,
      clients: clients.size,
      completed: completed.length,
      upcoming: upcoming.length,
      canceled: canceled.length,
      averageAppointmentValue:
        completed.length > 0 ? revenue / completed.length : 0,
      topServices,
      recentActivity,
    };
  }, [appointments, range, services]);

  async function shareReportPdf() {
    const html = `
      <html>
        <body style="font-family: Arial; padding: 24px;">
          <h1>Schedova Report</h1>
          <h2>${getRangeLabel(range)}</h2>
          <h3>Summary</h3>
          <p>Appointments: ${report.appointments}</p>
          <p>Revenue: ${formatCurrency(report.revenue)}</p>
          <p>Tips: ${formatCurrency(report.tips)}</p>
          <p>Clients: ${report.clients}</p>
          <h3>Business snapshot</h3>
          <p>Completed appointments: ${report.completed}</p>
          <p>Upcoming appointments: ${report.upcoming}</p>
          <p>Canceled appointments: ${report.canceled}</p>
          <p>Average appointment value: ${formatCurrency(
            report.averageAppointmentValue,
          )}</p>
          <h3>Top services</h3>
          ${
            report.topServices.length === 0
              ? "<p>No services in this range.</p>"
              : report.topServices
                  .map(
                    (service) =>
                      `<p>${service.name}: ${service.count} bookings, ${formatCurrency(
                        service.revenue,
                      )}</p>`,
                  )
                  .join("")
          }
        </body>
      </html>
    `;

    const file = await Print.printToFileAsync({ html });
    await Sharing.shareAsync(file.uri);
  }

  function Header() {
    return (
      <View style={{ marginBottom: 18 }}>
        <Text
          style={{
            color: colors.text,
            fontSize: 36,
            fontWeight: "900",
            lineHeight: 42,
          }}
        >
          Reports
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 16,
            lineHeight: 23,
            marginTop: 8,
          }}
        >
          Track your schedule, revenue, and business activity.
        </Text>
      </View>
    );
  }

  function Card({ children, subtle = false }: { children: ReactNode; subtle?: boolean }) {
    return (
      <View
        style={{
          backgroundColor: subtle ? colors.background : colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 16,
          marginBottom: 16,
        }}
      >
        {children}
      </View>
    );
  }

  function SectionTitle({
    title,
    action,
  }: {
    title: string;
    action?: ReactNode;
  }) {
    return (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 21, fontWeight: "900" }}>
          {title}
        </Text>
        {action}
      </View>
    );
  }

  function RangeFilters() {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: 4 }}
        style={{ marginBottom: 18 }}
      >
        {RANGES.map((item) => {
          const active = range === item.key;

          return (
            <Pressable
              key={item.key}
              onPress={() => setRange(item.key)}
              style={({ pressed }) => ({
                backgroundColor: active ? colors.primary : colors.card,
                borderWidth: 1,
                borderColor: active ? colors.primary : colors.border,
                paddingVertical: 10,
                paddingHorizontal: 15,
                borderRadius: 999,
                marginRight: 10,
                opacity: pressed ? 0.82 : 1,
              })}
            >
              <Text
                style={{
                  color: active ? "#FFFFFF" : colors.text,
                  fontWeight: "900",
                }}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  function MetricCard({
    label,
    value,
    helper,
    icon,
  }: {
    label: string;
    value: string;
    helper: string;
    icon: MetricIcon;
  }) {
    return (
      <View
        style={{
          flexBasis: "48%",
          flexGrow: 1,
          minHeight: 128,
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          borderRadius: 18,
          padding: 16,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: `${colors.primary}18`,
            marginBottom: 12,
          }}
        >
          <Ionicons name={icon} size={17} color={colors.primary} />
        </View>
        <Text
          style={{ color: colors.mutedText, fontSize: 12, fontWeight: "800" }}
        >
          {label}
        </Text>
        <Text
          style={{
            color: colors.text,
            fontSize: 27,
            fontWeight: "900",
            marginTop: 7,
          }}
        >
          {value}
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 12,
            lineHeight: 17,
            marginTop: 6,
          }}
        >
          {helper}
        </Text>
      </View>
    );
  }

  function SnapshotRow({
    label,
    value,
    isFirst = false,
  }: {
    label: string;
    value: string;
    isFirst?: boolean;
  }) {
    return (
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          borderTopColor: colors.border,
          borderTopWidth: isFirst ? 0 : 1,
          paddingVertical: 13,
          gap: 16,
        }}
      >
        <Text style={{ color: colors.mutedText, flex: 1, fontSize: 14 }}>
          {label}
        </Text>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>
          {value}
        </Text>
      </View>
    );
  }

  function PrimaryButton({
    label,
    onPress,
    disabled = false,
  }: {
    label: string;
    onPress: () => void;
    disabled?: boolean;
  }) {
    return (
      <Pressable
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: disabled ? colors.mutedText : colors.primary,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
          opacity: pressed ? 0.84 : 1,
        })}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>{label}</Text>
      </Pressable>
    );
  }

  function renderProGate() {
    if (!ENABLE_PRO) {
      return (
        <AppScreen scroll backgroundColor={colors.background} bottomPadding={56}>
          <Header />

          <Card>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 22,
                    fontWeight: "900",
                  }}
                >
                  Reports unavailable
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    marginTop: 10,
                    lineHeight: 21,
                  }}
                >
                  Reports are not available in this version of Schedova.
                </Text>
              </View>
              <View
                style={{
                  backgroundColor: `${colors.primary}18`,
                  borderRadius: 18,
                  height: 48,
                  width: 48,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons
                  name="bar-chart-outline"
                  size={24}
                  color={colors.primary}
                />
              </View>
            </View>
          </Card>
        </AppScreen>
      );
    }

    const proGateMetrics = [
      { label: "Appointments", icon: "calendar-outline" as MetricIcon },
      { label: "Revenue", icon: "cash-outline" as MetricIcon },
      { label: "Clients", icon: "people-outline" as MetricIcon },
      { label: "Services", icon: "sparkles-outline" as MetricIcon },
    ];

    return (
      <AppScreen scroll backgroundColor={colors.background} bottomPadding={56}>
        <Header />

        <Card>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 14,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}
              >
                Schedova Pro
              </Text>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 17,
                  fontWeight: "900",
                  marginTop: 12,
                }}
              >
                {PRO_UPSELL_COPY.reports}
              </Text>
            </View>
            <View
              style={{
                backgroundColor: `${colors.primary}18`,
                borderRadius: 18,
                height: 48,
                width: 48,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons
                name="bar-chart-outline"
                size={24}
                color={colors.primary}
              />
            </View>
          </View>

          <Text style={{ color: colors.mutedText, marginTop: 10, lineHeight: 21 }}>
            Track appointment totals, service performance, and business
            activity as your schedule grows.
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
            }}
          >
            {proGateMetrics.map((item) => (
              <View
                key={item.label}
                style={{
                  flexBasis: "48%",
                  flexGrow: 1,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <Ionicons name={item.icon} size={18} color={colors.primary} />
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: "900",
                    marginTop: 9,
                  }}
                >
                  {item.label}
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    marginTop: 4,
                  }}
                >
                  Included with Pro
                </Text>
              </View>
            ))}
          </View>

          <View style={{ marginTop: 18 }}>
            <PrimaryButton
              label="Upgrade to Schedova Pro"
              onPress={openSchedovaProScreen}
            />
          </View>
        </Card>
      </AppScreen>
    );
  }

  if (!reportsAvailable) return renderProGate();

  const noReportData = !loading && !loadError && report.appointments === 0;

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={72}>
      <Header />
      <RangeFilters />

      {loading ? (
        <Card>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: `${colors.primary}18`,
              }}
            >
              <Ionicons name="bar-chart-outline" color={colors.primary} size={20} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}
              >
                Loading reports...
              </Text>
              <Text
                style={{ color: colors.mutedText, marginTop: 3, lineHeight: 19 }}
              >
                Pulling together your appointment activity.
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {loadError ? (
        <Card>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
            Unable to load reports. Please try again.
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}>
            Your report data could not be refreshed right now.
          </Text>
          <View style={{ marginTop: 14 }}>
            <PrimaryButton label="Try Again" onPress={() => void fetchData()} />
          </View>
        </Card>
      ) : null}

      {noReportData ? (
        <Card>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 23,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: `${colors.primary}18`,
              marginBottom: 12,
            }}
          >
            <Ionicons name="calendar-outline" color={colors.primary} size={23} />
          </View>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
            No report data yet
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8, lineHeight: 21 }}>
            Book appointments to start seeing business insights here.
          </Text>
          <View style={{ marginTop: 14 }}>
            <PrimaryButton
              label="Book Appointment"
              onPress={() => router.push("/book-appointment" as any)}
            />
          </View>
        </Card>
      ) : null}

      {!loadError && !noReportData ? (
        <>
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <MetricCard
              label="Appointments"
              value={String(report.appointments)}
              helper={`In ${getRangeLabel(range).toLowerCase()}`}
              icon="calendar-outline"
            />
            <MetricCard
              label="Revenue"
              value={formatCurrency(report.revenue)}
              helper="Completed appointment value"
              icon="cash-outline"
            />
            <MetricCard
              label="Tips"
              value={formatCurrency(report.tips)}
              helper="Tips recorded in this range"
              icon="wallet-outline"
            />
            <MetricCard
              label="Clients"
              value={String(report.clients)}
              helper="Clients with appointments"
              icon="people-outline"
            />
          </View>

          <Card>
            <SectionTitle title="Business snapshot" />
            <SnapshotRow
              isFirst
              label="Completed appointments"
              value={String(report.completed)}
            />
            <SnapshotRow
              label="Upcoming appointments"
              value={String(report.upcoming)}
            />
            <SnapshotRow
              label="Canceled appointments"
              value={String(report.canceled)}
            />
            <SnapshotRow
              label="Average appointment value"
              value={formatCurrency(report.averageAppointmentValue)}
            />
          </Card>

          <Card>
            <SectionTitle
              title="Top services"
              action={
                <Pressable
                  onPress={() => router.push("/service-reports" as any)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                >
                  <Text style={{ color: colors.primary, fontWeight: "900" }}>
                    View service reports
                  </Text>
                </Pressable>
              }
            />

            {report.topServices.length === 0 ? (
              <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                No service activity in this range yet.
              </Text>
            ) : null}

            {report.topServices.map((service, index) => (
              <View
                key={service.id}
                style={{
                  borderTopColor: colors.border,
                  borderTopWidth: index === 0 ? 0 : 1,
                  paddingTop: index === 0 ? 0 : 14,
                  marginTop: index === 0 ? 0 : 14,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      flex: 1,
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    {service.name}
                  </Text>
                  <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
                    {service.count} booked
                  </Text>
                </View>
                <Text style={{ color: colors.mutedText, marginTop: 5 }}>
                  {formatCurrency(service.revenue)}
                </Text>
                <View
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 999,
                    height: 8,
                    marginTop: 9,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: colors.primary,
                      borderRadius: 999,
                      height: 8,
                      width: `${Math.max(6, service.percent)}%`,
                    }}
                  />
                </View>
              </View>
            ))}
          </Card>

          <Card>
            <SectionTitle title="Recent appointment activity" />

            {report.recentActivity.length === 0 ? (
              <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
                No recent appointments in this range.
              </Text>
            ) : null}

            {report.recentActivity.map((appointment, index) => (
              <View
                key={appointment.id}
                style={{
                  borderTopColor: colors.border,
                  borderTopWidth: index === 0 ? 0 : 1,
                  paddingTop: index === 0 ? 0 : 13,
                  marginTop: index === 0 ? 0 : 13,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <Text
                    style={{
                      color: colors.text,
                      flex: 1,
                      fontSize: 16,
                      fontWeight: "900",
                    }}
                  >
                    {appointment.clientName}
                  </Text>
                  <Text style={{ color: colors.text, fontWeight: "900" }}>
                    {formatCurrency(appointment.price)}
                  </Text>
                </View>
                <Text style={{ color: colors.mutedText, marginTop: 5 }}>
                  {appointment.dateLabel} | {appointment.statusLabel}
                </Text>
              </View>
            ))}
          </Card>

          <Card subtle>
            <SectionTitle
              title="Service details"
              action={
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.primary}
                />
              }
            />
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              See service booking counts, completed totals, tips, cancellations,
              and no-shows by service.
            </Text>
            <View style={{ marginTop: 14 }}>
              <PrimaryButton
                label="View service reports"
                onPress={() => router.push("/service-reports" as any)}
              />
            </View>
          </Card>

          <Pressable
            disabled={loading || report.appointments === 0}
            onPress={() => void shareReportPdf()}
            style={({ pressed }) => ({
              backgroundColor:
                loading || report.appointments === 0
                  ? colors.mutedText
                  : colors.primary,
              borderRadius: 14,
              padding: 16,
              alignItems: "center",
              opacity: pressed ? 0.84 : 1,
            })}
          >
            <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
              Share / Print PDF Report
            </Text>
          </Pressable>
        </>
      ) : null}
    </AppScreen>
  );
}
