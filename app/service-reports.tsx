import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import {
  getAppointmentServices,
  getAppointmentServiceTotal,
} from "../lib/appointmentServices";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import { openSchedovaProScreen } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type RangeKey = "week" | "month" | "last30" | "all";

type RangeBounds = {
  start: Date | null;
  end: Date | null;
};

type ServiceStat = {
  id: string;
  name: string;
  price: number;
  colorHex: string;
  booked: number;
  completed: number;
  cancelled: number;
  noShows: number;
  revenue: number;
  totalTips: number;
  averageTip: number;
  sharePercent: number;
  progressPercent: number;
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

function formatPercent(value: number) {
  return `${Math.round(Number(value || 0))}%`;
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

function getRangeLabel(range: RangeKey) {
  return RANGES.find((item) => item.key === range)?.label || "Selected range";
}

function isCancelledStatus(status: string | null | undefined) {
  return [
    "canceled",
    "cancelled",
    "customer_canceled",
    "customer_cancelled",
    "business_canceled",
    "business_cancelled",
  ].includes(String(status || ""));
}

function isArchivedAppointment(appointment: any) {
  return Boolean(appointment.archived || appointment.archived_at);
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

function createEmptyServiceStat(service: any): ServiceStat {
  const color =
    typeof service?.color_hex === "string" && service.color_hex.trim()
      ? service.color_hex
      : "#0F766E";

  return {
    id: String(service?.id || service?.name || "unknown"),
    name: service?.name || "Unknown Service",
    price: Number(service?.price || 0),
    colorHex: color,
    booked: 0,
    completed: 0,
    cancelled: 0,
    noShows: 0,
    revenue: 0,
    totalTips: 0,
    averageTip: 0,
    sharePercent: 0,
    progressPercent: 0,
  };
}

export default function ServiceReportsScreen() {
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
      console.log("Service reports load failed", error);
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
    const statsByService = new Map<string, ServiceStat>();

    services.forEach((service) => {
      const stat = createEmptyServiceStat(service);
      statsByService.set(stat.id, stat);
    });

    const filteredAppointments = appointments
      .filter((appointment) => !isArchivedAppointment(appointment))
      .filter((appointment) => {
        const date = parseAppointmentDate(appointment);
        if (Number.isNaN(date.getTime())) return false;
        return (!start || date >= start) && (!end || date <= end);
      });

    filteredAppointments.forEach((appointment) => {
      const appointmentServices = getAppointmentServices(
        appointment,
        services,
      );

      if (appointmentServices.length === 0) return;

      const appointmentPrice = getAppointmentPrice(appointment, services);
      const appointmentServiceTotal = getAppointmentServiceTotal(
        appointment,
        services,
      );
      const tipShare =
        Number(appointment.tip_amount || 0) / appointmentServices.length;

      appointmentServices.forEach((service) => {
        const serviceId = String(service.id || service.name);
        const existingStat =
          statsByService.get(serviceId) || createEmptyServiceStat(service);

        existingStat.booked += 1;

        if (appointment.status === "completed") {
          const servicePrice = Number(service.price || 0);
          const revenueShare =
            appointmentServiceTotal > 0
              ? appointmentPrice * (servicePrice / appointmentServiceTotal)
              : appointmentPrice / appointmentServices.length;

          existingStat.completed += 1;
          existingStat.revenue += Number.isFinite(revenueShare)
            ? revenueShare
            : 0;
          existingStat.totalTips += Number.isFinite(tipShare) ? tipShare : 0;
        } else if (isCancelledStatus(appointment.status)) {
          existingStat.cancelled += 1;
        } else if (appointment.status === "no_show") {
          existingStat.noShows += 1;
        }

        statsByService.set(serviceId, existingStat);
      });
    });

    const rawStats = Array.from(statsByService.values());
    const bookedTotal = rawStats.reduce(
      (sum, service) => sum + service.booked,
      0,
    );
    const completedTotal = rawStats.reduce(
      (sum, service) => sum + service.completed,
      0,
    );
    const revenueTotal = rawStats.reduce(
      (sum, service) => sum + service.revenue,
      0,
    );
    const maxBooked = Math.max(
      1,
      ...rawStats.map((service) => service.booked),
    );

    const serviceStats = rawStats
      .map((service) => ({
        ...service,
        averageTip:
          service.completed > 0 ? service.totalTips / service.completed : 0,
        sharePercent:
          bookedTotal > 0 ? Math.round((service.booked / bookedTotal) * 100) : 0,
        progressPercent: Math.round((service.booked / maxBooked) * 100),
      }))
      .sort((a, b) => b.booked - a.booked || b.revenue - a.revenue);

    const bookedServices = serviceStats.filter((service) => service.booked > 0);
    const topBookedService = bookedServices[0] || null;
    const highestRevenueService =
      [...bookedServices].sort((a, b) => b.revenue - a.revenue)[0] || null;

    return {
      serviceStats: bookedServices,
      bookedTotal,
      revenueTotal,
      completedTotal,
      topBookedService,
      highestRevenueService,
      averageServiceValue:
        completedTotal > 0 ? revenueTotal / completedTotal : 0,
    };
  }, [appointments, range, services]);

  const noReportData =
    !loading && !loadError && report.serviceStats.length === 0;

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
          Service Reports
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: 16,
            lineHeight: 23,
            marginTop: 8,
          }}
        >
          See which services are booked most often and how they contribute to
          your business.
        </Text>
      </View>
    );
  }

  function Card({ children }: { children: ReactNode }) {
    return (
      <View
        style={{
          backgroundColor: colors.card,
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
          numberOfLines={2}
          style={{
            color: colors.text,
            fontSize: 25,
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

  function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: colors.primary,
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
                  Service reports unavailable
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    marginTop: 10,
                    lineHeight: 21,
                  }}
                >
                  Service reports are not available in this version of
                  Schedova.
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
                  name="stats-chart-outline"
                  size={24}
                  color={colors.primary}
                />
              </View>
            </View>
          </Card>
        </AppScreen>
      );
    }

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
                Service reports are included with Schedova Pro.
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
                name="stats-chart-outline"
                size={24}
                color={colors.primary}
              />
            </View>
          </View>

          <Text style={{ color: colors.mutedText, marginTop: 10, lineHeight: 21 }}>
            See which services are booked most often and how they contribute to
            your business.
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 10,
              marginTop: 18,
            }}
          >
            {[
              "Top booked service",
              "Service revenue",
              "Booking share",
              "Average value",
            ].map((item) => (
              <View
                key={item}
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
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 15,
                    fontWeight: "900",
                  }}
                >
                  {item}
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    marginTop: 5,
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
              <Ionicons
                name="stats-chart-outline"
                color={colors.primary}
                size={20}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}
              >
                Loading service reports...
              </Text>
              <Text
                style={{ color: colors.mutedText, marginTop: 3, lineHeight: 19 }}
              >
                Pulling together your service activity.
              </Text>
            </View>
          </View>
        </Card>
      ) : null}

      {loadError ? (
        <Card>
          <Text style={{ color: colors.text, fontSize: 20, fontWeight: "900" }}>
            Unable to load service reports. Please try again.
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8, lineHeight: 20 }}>
            Your service report data could not be refreshed right now.
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
            <Ionicons
              name="sparkles-outline"
              color={colors.primary}
              size={23}
            />
          </View>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
            No service report data yet
          </Text>
          <Text style={{ color: colors.mutedText, marginTop: 8, lineHeight: 21 }}>
            Book appointments with services to start seeing service insights.
          </Text>
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
              label="Services booked"
              value={String(report.bookedTotal)}
              helper={`In ${getRangeLabel(range).toLowerCase()}`}
              icon="calendar-outline"
            />
            <MetricCard
              label="Top booked"
              value={report.topBookedService?.name || "None yet"}
              helper={
                report.topBookedService
                  ? `${report.topBookedService.booked} bookings`
                  : "No service bookings"
              }
              icon="trophy-outline"
            />
            <MetricCard
              label="Highest revenue"
              value={report.highestRevenueService?.name || "None yet"}
              helper={
                report.highestRevenueService
                  ? formatCurrency(report.highestRevenueService.revenue)
                  : "Completed service value"
              }
              icon="cash-outline"
            />
            <MetricCard
              label="Average service value"
              value={formatCurrency(report.averageServiceValue)}
              helper="Completed services only"
              icon="analytics-outline"
            />
          </View>

          <Card>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <Text
                style={{ color: colors.text, fontSize: 21, fontWeight: "900" }}
              >
                Service performance
              </Text>
              <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
                {report.serviceStats.length} services
              </Text>
            </View>

            {report.serviceStats.map((service, index) => (
              <View
                key={service.id}
                style={{
                  borderTopColor: colors.border,
                  borderTopWidth: index === 0 ? 0 : 1,
                  paddingTop: index === 0 ? 0 : 16,
                  marginTop: index === 0 ? 0 : 16,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12,
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: colors.text,
                        fontSize: 17,
                        fontWeight: "900",
                      }}
                    >
                      {service.name}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedText,
                        fontSize: 13,
                        marginTop: 4,
                      }}
                    >
                      Listed price: {formatCurrency(service.price)}
                    </Text>
                  </View>
                  <View
                    style={{
                      backgroundColor: `${service.colorHex}24`,
                      borderColor: service.colorHex,
                      borderWidth: 1,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                    }}
                  >
                    <Text
                      style={{
                        color: service.colorHex,
                        fontSize: 12,
                        fontWeight: "900",
                      }}
                    >
                      {formatPercent(service.sharePercent)}
                    </Text>
                  </View>
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 13,
                  }}
                >
                  {[
                    ["Booked", String(service.booked)],
                    ["Revenue", formatCurrency(service.revenue)],
                    ["Completed", String(service.completed)],
                    ["Avg tip", formatCurrency(service.averageTip)],
                  ].map(([label, value]) => (
                    <View
                      key={label}
                      style={{
                        flexBasis: "48%",
                        flexGrow: 1,
                        backgroundColor: colors.background,
                        borderColor: colors.border,
                        borderWidth: 1,
                        borderRadius: 13,
                        padding: 12,
                      }}
                    >
                      <Text
                        style={{
                          color: colors.mutedText,
                          fontSize: 11,
                          fontWeight: "800",
                        }}
                      >
                        {label}
                      </Text>
                      <Text
                        style={{
                          color: colors.text,
                          fontSize: 17,
                          fontWeight: "900",
                          marginTop: 5,
                        }}
                      >
                        {value}
                      </Text>
                    </View>
                  ))}
                </View>

                <View
                  style={{
                    backgroundColor: colors.background,
                    borderRadius: 999,
                    height: 8,
                    marginTop: 12,
                    overflow: "hidden",
                  }}
                >
                  <View
                    style={{
                      backgroundColor: service.colorHex,
                      borderRadius: 999,
                      height: 8,
                      width: `${Math.max(6, service.progressPercent)}%`,
                    }}
                  />
                </View>

                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 12,
                    marginTop: 8,
                  }}
                >
                  {service.cancelled} canceled | {service.noShows} no-show
                </Text>
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </AppScreen>
  );
}
