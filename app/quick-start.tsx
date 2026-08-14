import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { DatePickerField } from "../components/booking/DatePickerField";
import { DurationStepper } from "../components/booking/DurationStepper";
import { todayIso } from "../components/booking/bookingUtils";
import { TimeDropdown } from "../components/booking/TimeDropdown";
import type { ThemeColors } from "../components/booking/types";
import { AppButton, AppCard, AppScreen, AppTextInput } from "../components/ui";
import { trackAnalyticsEvent } from "../lib/analytics";
import { useAuthSession } from "../lib/authSession";
import type { CalendarIntervalMinutes } from "../lib/calendarPreferences";
import {
  loadQuickStartBooking,
  normalizeQuickStartId,
  prepareQuickStartBooking,
  quickStartNumber,
  QuickStartBookingError,
  type QuickStartClient,
  type QuickStartService,
} from "../lib/quickStartBooking";
import { settleActiveTextInput } from "../lib/settleTextInputs";
import { useAppTheme } from "../lib/useAppTheme";

const isTablet = Dimensions.get("window").width >= 768;

type QuickStartParams = {
  stage?: string | string[];
  clientId?: string | string[];
  serviceId?: string | string[];
  appointmentDate?: string | string[];
  appointmentTime?: string | string[];
};

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}

export default function QuickStartScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<QuickStartParams>();
  const { colors } = useAppTheme();
  const { isAccountReady, userId } = useAuthSession();
  const flowViewedRef = useRef(false);
  const successViewedRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clients, setClients] = useState<QuickStartClient[]>([]);
  const [services, setServices] = useState<QuickStartService[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [servicePrice, setServicePrice] = useState("");
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [appointmentDate, setAppointmentDate] = useState(todayIso());
  const [appointmentTime, setAppointmentTime] = useState("09:00");
  const [calendarInterval, setCalendarInterval] =
    useState<CalendarIntervalMinutes>(30);
  const [use24Hour, setUse24Hour] = useState(false);

  const stage = routeParam(params.stage);
  const isSuccessStage = stage === "success";
  const successClientId = normalizeQuickStartId(routeParam(params.clientId));
  const successServiceId = normalizeQuickStartId(routeParam(params.serviceId));
  const successAppointmentDate = routeParam(params.appointmentDate);
  const successAppointmentTime = routeParam(params.appointmentTime);

  const bookingColors = useMemo<ThemeColors>(
    () => ({
      background: colors.background,
      card: colors.card,
      text: colors.text,
      mutedText: colors.mutedText,
      border: colors.border,
      primary: colors.primary,
    }),
    [colors],
  );
  const selectedServiceDefaultMinutes = useMemo(() => {
    const selectedService = services.find(
      (service) =>
        normalizeQuickStartId(service.id) ===
        normalizeQuickStartId(selectedServiceId),
    );

    return selectedService
      ? Math.max(5, quickStartNumber(selectedService.duration_minutes, 30))
      : 30;
  }, [selectedServiceId, services]);

  const applyClient = useCallback((client: QuickStartClient) => {
    setSelectedClientId(normalizeQuickStartId(client.id));
    setClientName(String(client.name || ""));
    setClientPhone(String(client.phone || ""));
  }, []);

  const applyService = useCallback((service: QuickStartService) => {
    setSelectedServiceId(normalizeQuickStartId(service.id));
    setServiceName(String(service.name || ""));
    setServicePrice(
      service.price === null || service.price === undefined
        ? ""
        : String(service.price),
    );
    setDurationMinutes(
      Math.max(5, quickStartNumber(service.duration_minutes, 30)),
    );
  }, []);

  useEffect(() => {
    if (!isAccountReady || !userId) return;

    let active = true;

    void (async () => {
      if (isSuccessStage) {
        if (active) setLoading(false);
        return;
      }

      try {
        const loaded = await loadQuickStartBooking(userId);
        if (!active) return;

        if (loaded.hasAppointment) {
          router.replace("/dashboard" as any);
          return;
        }

        setClients(loaded.clients);
        setServices(loaded.services);
        setCalendarInterval(loaded.intervalMinutes);
        setUse24Hour(loaded.use24Hour);
        setAppointmentDate(loaded.defaultDate);
        setAppointmentTime(loaded.defaultTime);

        if (loaded.clients.length === 1) applyClient(loaded.clients[0]);
        if (loaded.services.length === 1) applyService(loaded.services[0]);

        if (!flowViewedRef.current) {
          flowViewedRef.current = true;
          trackAnalyticsEvent("first_booking_flow_opened");
        }
      } catch (error) {
        console.log("[QuickStart] initial load failed", error);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [applyClient, applyService, isAccountReady, isSuccessStage, router, userId]);

  useEffect(() => {
    if (!isSuccessStage || !isAccountReady) return;
    if (successViewedRef.current) return;

    successViewedRef.current = true;
    trackAnalyticsEvent("first_booking_success_viewed");
  }, [isAccountReady, isSuccessStage]);

  async function continueToBooking() {
    if (saving) return;

    await settleActiveTextInput();
    setSaving(true);
    trackAnalyticsEvent("first_booking_handoff_started");

    try {
      const result = await prepareQuickStartBooking({
        userId: userId || "",
        clientName,
        clientPhone,
        serviceName,
        servicePrice,
        durationMinutes,
        appointmentDate,
        appointmentTime,
        clients,
        services,
        selectedClientId,
        selectedServiceId,
      });
      if (!result) return;

      applyClient(result.client);
      applyService(result.service);

      if (result.clientCreated) {
        trackAnalyticsEvent("first_client_created");
        setClients((current) =>
          current.some(
            (client) =>
              normalizeQuickStartId(client.id) ===
              normalizeQuickStartId(result.client.id),
          )
            ? current
            : [...current, result.client],
        );
      }
      if (result.serviceCreated) {
        trackAnalyticsEvent("first_service_created");
        setServices((current) =>
          current.some(
            (service) =>
              normalizeQuickStartId(service.id) ===
              normalizeQuickStartId(result.service.id),
          )
            ? current
            : [...current, result.service],
        );
      }

      trackAnalyticsEvent("first_booking_handoff_completed");
      router.push({
        pathname: "/book-appointment",
        params: {
          clientId: result.clientId,
          serviceId: result.serviceId,
          appointmentDate: result.appointmentDate,
          appointmentTime: result.appointmentTime,
          activationFlow: "first-booking",
          returnTo: "/dashboard",
        },
      } as any);
    } catch (error) {
      console.log("[QuickStart] prepare booking failed", error);
      Alert.alert(
        error instanceof QuickStartBookingError
          ? error.title
          : "Could not continue",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function openDashboard() {
    router.replace("/dashboard" as any);
  }

  function addAnotherAppointment() {
    const paramsForNextBooking: Record<string, string> = {
      returnTo: "/dashboard",
    };

    if (successClientId) paramsForNextBooking.clientId = successClientId;
    if (successServiceId) paramsForNextBooking.serviceId = successServiceId;
    if (successAppointmentDate) {
      paramsForNextBooking.appointmentDate = successAppointmentDate;
    }
    if (successAppointmentTime) {
      paramsForNextBooking.appointmentTime = successAppointmentTime;
    }

    router.push({
      pathname: "/book-appointment",
      params: paramsForNextBooking,
    } as any);
  }

  if (!isAccountReady || loading) {
    return (
      <AppScreen
        backgroundColor={colors.background}
        horizontalPadding={24}
        contentContainerStyle={styles.centered}
      >
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.loadingText, { color: colors.mutedText }]}>
          Preparing your next appointment...
        </Text>
      </AppScreen>
    );
  }

  if (isSuccessStage) {
    return (
      <AppScreen
        scroll
        backgroundColor={colors.background}
        horizontalPadding={24}
        topPadding={36}
        contentContainerStyle={styles.successContainer}
      >
        <View
          style={[styles.successIcon, { backgroundColor: `${colors.primary}1F` }]}
        >
          <Ionicons name="checkmark" size={42} color={colors.primary} />
        </View>
        <Text style={[styles.successTitle, { color: colors.text }]}>
          Your first appointment is booked
        </Text>
        <Text style={[styles.successText, { color: colors.mutedText }]}>
          You used the full booking flow to save it, so availability, blocked
          time, double-booking, and plan checks all stayed in place.
        </Text>

        <AppCard style={styles.successCard}>
          {[
            "Client saved or reused",
            "Service saved or reused",
            "Appointment added to your schedule",
          ].map((label, index) => (
            <View
              key={label}
              style={[styles.successRow, index < 2 && styles.successRowSpacing]}
            >
              <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              <Text style={[styles.successRowText, { color: colors.text }]}>
                {label}
              </Text>
            </View>
          ))}
        </AppCard>

        <AppButton
          title="View my schedule"
          onPress={openDashboard}
          style={styles.primaryAction}
        />
        <AppButton
          title="Add another appointment"
          variant="secondary"
          onPress={addAnotherAppointment}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={24}
      topPadding={28}
    >
      <View style={[styles.heroIcon, { backgroundColor: `${colors.primary}1F` }]}>
        <Ionicons name="calendar-outline" size={28} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.text }]}>
        Add your next appointment
      </Text>
      <Text style={[styles.subtitle, { color: colors.mutedText }]}>
        Enter the basics here. We will save the client and service when needed,
        then open the full booking screen so you can finish with the usual
        schedule checks.
      </Text>

      <AppCard style={styles.valueCard}>
        <View style={styles.valueRow}>
          {[
            { icon: "person-outline" as const, label: "Client" },
            { icon: "cut-outline" as const, label: "Service" },
            { icon: "calendar-outline" as const, label: "Time" },
          ].map((item) => (
            <View key={item.label} style={styles.valueItem}>
              <Ionicons name={item.icon} size={21} color={colors.primary} />
              <Text style={[styles.valueLabel, { color: colors.text }]}>
                {item.label}
              </Text>
            </View>
          ))}
        </View>
      </AppCard>

      {clients.length > 0 ? (
        <ChoiceSection
          title="Use an existing client"
          items={clients.slice(0, 8).map((client) => ({
            id: normalizeQuickStartId(client.id),
            label: String(client.name || client.phone || client.email || "Client"),
            onPress: () => applyClient(client),
          }))}
          selectedId={selectedClientId}
          colors={bookingColors}
        />
      ) : null}

      <AppCard style={styles.sectionCard}>
        <SectionTitle color={colors.text}>Who is the appointment for?</SectionTitle>
        <AppTextInput
          label="Client name"
          value={clientName}
          onChangeText={(value) => {
            setClientName(value);
            setSelectedClientId("");
          }}
          placeholder="Example: Jamie Smith"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <AppTextInput
          label="Phone number (optional)"
          value={clientPhone}
          onChangeText={(value) => {
            setClientPhone(value);
            setSelectedClientId("");
          }}
          placeholder="Used later for confirmations and reminders"
          keyboardType="phone-pad"
          containerStyle={styles.lastInput}
        />
      </AppCard>

      {services.length > 0 ? (
        <ChoiceSection
          title="Use an existing service"
          items={services.slice(0, 8).map((service) => ({
            id: normalizeQuickStartId(service.id),
            label: String(service.name || "Service"),
            onPress: () => applyService(service),
          }))}
          selectedId={selectedServiceId}
          colors={bookingColors}
        />
      ) : null}

      <AppCard style={styles.sectionCard}>
        <SectionTitle color={colors.text}>What are they booking?</SectionTitle>
        <AppTextInput
          label="Service"
          value={serviceName}
          onChangeText={(value) => {
            setServiceName(value);
            setSelectedServiceId("");
          }}
          placeholder="Example: Haircut"
          autoCapitalize="words"
          returnKeyType="next"
        />
        <AppTextInput
          label="Price (optional)"
          value={servicePrice}
          onChangeText={(value) => {
            setServicePrice(value);
            setSelectedServiceId("");
          }}
          placeholder="0.00"
          keyboardType="decimal-pad"
        />
        <DurationStepper
          durationMinutes={durationMinutes}
          defaultMinutes={selectedServiceDefaultMinutes}
          onChange={(value) => {
            setDurationMinutes(value);
            setSelectedServiceId("");
          }}
          colors={bookingColors}
        />
      </AppCard>

      <AppCard style={styles.scheduleCard}>
        <SectionTitle color={colors.text}>When is it?</SectionTitle>
        <DatePickerField
          colors={bookingColors}
          value={appointmentDate}
          onChange={setAppointmentDate}
          isTablet={isTablet}
        />
        <TimeDropdown
          label="Start time"
          value={appointmentTime}
          onChange={setAppointmentTime}
          colors={bookingColors}
          use24Hour={use24Hour}
          intervalMinutes={calendarInterval}
          marginTop={14}
        />
      </AppCard>

      <AppButton
        title="Continue to booking"
        loading={saving}
        onPress={() => void continueToBooking()}
      />
      <Text style={[styles.helperText, { color: colors.mutedText }]}>
        We will reuse matching clients and services when possible.
      </Text>
      <AppButton
        title="Back to dashboard"
        variant="ghost"
        disabled={saving}
        onPress={openDashboard}
        style={styles.skipButton}
      />
    </AppScreen>
  );
}

function SectionTitle({ children, color }: { children: string; color: string }) {
  return <Text style={[styles.sectionTitle, { color }]}>{children}</Text>;
}

function ChoiceSection({
  title,
  items,
  selectedId,
  colors,
}: {
  title: string;
  items: { id: string; label: string; onPress: () => void }[];
  selectedId: string;
  colors: ThemeColors;
}) {
  return (
    <View style={styles.choiceSection}>
      <Text style={[styles.choiceTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.chipRow}>
        {items.map((item) => {
          const selected = selectedId === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={item.onPress}
              style={[
                styles.choiceChip,
                {
                  backgroundColor: selected ? colors.primary : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: selected ? "#FFFFFF" : colors.text },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
  loadingText: { fontWeight: "700", marginTop: 12 },
  heroIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 16,
    height: 52,
    justifyContent: "center",
    marginBottom: 18,
    width: 52,
  },
  title: { fontSize: 32, fontWeight: "900", lineHeight: 38 },
  subtitle: { fontSize: 16, lineHeight: 23, marginBottom: 22, marginTop: 8 },
  valueCard: { marginBottom: 18 },
  valueRow: { flexDirection: "row", gap: 10 },
  valueItem: { alignItems: "center", flex: 1 },
  valueLabel: {
    fontSize: 12,
    fontWeight: "800",
    marginTop: 6,
    textAlign: "center",
  },
  choiceSection: { marginBottom: 18 },
  choiceTitle: { fontSize: 16, fontWeight: "900", marginBottom: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choiceChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  chipText: { fontWeight: "800" },
  sectionCard: { marginBottom: 18 },
  scheduleCard: { marginBottom: 22 },
  sectionTitle: { fontSize: 19, fontWeight: "900", marginBottom: 16 },
  lastInput: { marginBottom: 0 },
  helperText: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 10,
    textAlign: "center",
  },
  skipButton: { marginTop: 8 },
  successContainer: { flexGrow: 1, justifyContent: "center" },
  successIcon: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 999,
    height: 76,
    justifyContent: "center",
    marginBottom: 22,
    width: 76,
  },
  successTitle: { fontSize: 30, fontWeight: "900", textAlign: "center" },
  successText: {
    fontSize: 16,
    lineHeight: 23,
    marginBottom: 24,
    marginTop: 10,
    textAlign: "center",
  },
  successCard: { marginBottom: 22 },
  successRow: { alignItems: "center", flexDirection: "row", gap: 10 },
  successRowSpacing: { marginBottom: 14 },
  successRowText: { flex: 1, fontWeight: "800" },
  primaryAction: { marginBottom: 10 },
});
