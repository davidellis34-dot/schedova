import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { TimeDropdown } from "../components/booking/TimeDropdown";
import { todayIso } from "../components/booking/bookingUtils";
import type { ThemeColors } from "../components/booking/types";
import { AppButton, AppCard, AppScreen, AppTextInput } from "../components/ui";
import { trackAnalyticsEvent } from "../lib/analytics";
import { emitAppointmentUpserted } from "../lib/appointmentEvents";
import { useAuthSession } from "../lib/authSession";
import type { CalendarIntervalMinutes } from "../lib/calendarPreferences";
import {
  markFirstBookingActivationCompleted,
  markFirstBookingActivationDismissed,
} from "../lib/firstBookingActivation";
import {
  getOnboardingState,
  markOnboardingComplete,
  markOnboardingSkipped,
  saveOnboardingState,
} from "../lib/onboarding";
import {
  QuickStartBookingError,
  ensureQuickStartBusinessProfile,
  loadQuickStartBooking,
  normalizeQuickStartId,
  quickStartNumber,
  saveQuickStartBooking,
  type QuickStartClient,
  type QuickStartService,
} from "../lib/quickStartBooking";
import { emitSaveNotice } from "../lib/saveNoticeEvents";
import { settleActiveTextInput } from "../lib/settleTextInputs";
import { useAppTheme } from "../lib/useAppTheme";

const DURATION_OPTIONS = [30, 45, 60, 90] as const;
const isTablet = Dimensions.get("window").width >= 768;

type SavedBooking = {
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  appointmentDate: string;
  appointmentTime: string;
};

function displayDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function displayTime(value: string) {
  const [hoursText, minutesText = "00"] = value.slice(0, 5).split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function clientLabel(client: QuickStartClient) {
  return String(client.name || client.phone || client.email || "Client");
}

function serviceLabel(service: QuickStartService) {
  return String(service.name || "Service");
}

export default function QuickStartScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { isAccountReady, userId } = useAuthSession();
  const viewedRef = useRef(false);
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
  const [savedBooking, setSavedBooking] = useState<SavedBooking | null>(null);

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

  const applyClient = useCallback((client: QuickStartClient) => {
    setSelectedClientId(normalizeQuickStartId(client.id));
    setClientName(clientLabel(client));
    setClientPhone(String(client.phone || ""));
  }, []);

  const applyService = useCallback((service: QuickStartService) => {
    setSelectedServiceId(normalizeQuickStartId(service.id));
    setServiceName(serviceLabel(service));
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
      try {
        const [loaded, onboardingState] = await Promise.all([
          loadQuickStartBooking(userId),
          getOnboardingState(userId),
        ]);
        if (!active) return;

        if (loaded.hasAppointment) {
          try {
            if (!onboardingState.completed) {
              await markOnboardingComplete(userId);
              trackAnalyticsEvent("onboarding_completed");
            }
            await markFirstBookingActivationCompleted(userId);
          } catch (error) {
            console.log("[QuickStart] existing appointment repair failed", error);
          }
          if (active) router.replace("/dashboard" as any);
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

        if (!onboardingState.started) {
          await saveOnboardingState(userId, { started: true });
          trackAnalyticsEvent("onboarding_started");
        }
        if (!viewedRef.current) {
          viewedRef.current = true;
          trackAnalyticsEvent("first_booking_prompt_viewed");
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
  }, [applyClient, applyService, isAccountReady, router, userId]);

  async function save() {
    if (saving) return;

    await settleActiveTextInput();
    setSaving(true);
    trackAnalyticsEvent("first_booking_save_started");

    try {
      const result = await saveQuickStartBooking({
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

      const onboardingState = await getOnboardingState(userId || "");
      try {
        await saveOnboardingState(userId || "", {
          started: true,
          draft: {
            ...(result.businessId ? { businessId: result.businessId } : {}),
            serviceId: result.serviceId,
            clientId: result.clientId,
            appointmentId: result.appointmentId,
            step: 4,
          },
        });
        await markOnboardingComplete(userId || "");
        await markFirstBookingActivationCompleted(userId || "");
      } catch (error) {
        console.log("[QuickStart] local completion state failed", error);
      }

      if (result.clientCreated) trackAnalyticsEvent("first_client_created");
      if (result.serviceCreated) trackAnalyticsEvent("first_service_created");
      trackAnalyticsEvent("first_appointment_created");
      trackAnalyticsEvent("first_booking_save_completed");
      if (!onboardingState.completed) {
        trackAnalyticsEvent("onboarding_completed");
      }

      if (result.clientCreated) {
        setClients((current) => [...current, result.client]);
      }
      if (result.serviceCreated) {
        setServices((current) => [...current, result.service]);
      }
      emitAppointmentUpserted([result.appointment]);
      emitSaveNotice("Your first appointment is on the schedule.");
      setSavedBooking({
        clientId: result.clientId,
        clientName: result.clientName,
        serviceId: result.serviceId,
        serviceName: result.serviceName,
        appointmentDate: result.appointmentDate,
        appointmentTime: result.appointmentTime,
      });
    } catch (error) {
      console.log("[QuickStart] first booking save failed", error);
      Alert.alert(
        error instanceof QuickStartBookingError
          ? error.title
          : "Could not add the appointment",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function skipForNow() {
    if (!userId || saving) return;

    setSaving(true);
    try {
      const businessId = await ensureQuickStartBusinessProfile(userId);
      const onboardingState = await getOnboardingState(userId);
      if (!onboardingState.completed) {
        await markOnboardingSkipped(
          userId,
          businessId ? { businessId } : {},
        );
        trackAnalyticsEvent("onboarding_completed");
      }
      await markFirstBookingActivationDismissed(userId);
      trackAnalyticsEvent("first_booking_prompt_skipped");
      router.replace("/dashboard" as any);
    } catch (error) {
      console.log("[QuickStart] skip failed", error);
      Alert.alert("Could not continue", "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function confirmSkip() {
    Alert.alert(
      "Go to the dashboard?",
      "You can add your first appointment later, but Schedova is most useful once your real schedule is in the app.",
      [
        { text: "Keep booking", style: "cancel" },
        { text: "Go to dashboard", onPress: () => void skipForNow() },
      ],
    );
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
          Preparing your first booking...
        </Text>
      </AppScreen>
    );
  }

  if (savedBooking) {
    return (
      <AppScreen
        scroll
        backgroundColor={colors.background}
        horizontalPadding={24}
        topPadding={36}
        contentContainerStyle={styles.successContainer}
      >
        <View style={[styles.successIcon, { backgroundColor: `${colors.primary}1F` }]}>
          <Ionicons name="checkmark" size={42} color={colors.primary} />
        </View>
        <Text style={[styles.successTitle, { color: colors.text }]}>
          Your first booking is organized
        </Text>
        <Text style={[styles.successText, { color: colors.mutedText }]}>
          {savedBooking.clientName} is scheduled for {savedBooking.serviceName}{" "}
          on {displayDate(savedBooking.appointmentDate)} at{" "}
          {displayTime(savedBooking.appointmentTime)}.
        </Text>

        <AppCard style={styles.successCard}>
          {[
            "Client saved",
            "Service saved",
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
          title="See my schedule"
          onPress={() => router.replace("/dashboard" as any)}
          style={styles.primaryAction}
        />
        <AppButton
          title="Add another appointment"
          variant="secondary"
          onPress={() =>
            router.replace({
              pathname: "/book-appointment",
              params: {
                clientId: savedBooking.clientId,
                serviceId: savedBooking.serviceId,
                appointmentDate: savedBooking.appointmentDate,
                returnTo: "/dashboard",
              },
            } as any)
          }
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
        Enter what you already know. Schedova will save the client, service, and
        appointment for you.
      </Text>

      <AppCard style={styles.valueCard}>
        <View style={styles.valueRow}>
          {[
            { icon: "person-outline" as const, label: "Client" },
            { icon: "cut-outline" as const, label: "Service" },
            { icon: "calendar-outline" as const, label: "Schedule" },
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
            label: clientLabel(client),
            onPress: () => applyClient(client),
          }))}
          selectedId={selectedClientId}
          colors={bookingColors}
        />
      ) : null}

      <AppCard style={styles.sectionCard}>
        <SectionTitle color={colors.text}>Who is the appointment for?</SectionTitle>
        <AppTextInput
          label="Client name (or use phone below)"
          value={clientName}
          onChangeText={(value) => {
            setClientName(value);
            setSelectedClientId("");
          }}
          placeholder="Example: Jamie"
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
            label: serviceLabel(service),
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
        <Text style={[styles.fieldLabel, { color: colors.text }]}>Duration</Text>
        <View style={styles.chipRow}>
          {DURATION_OPTIONS.map((minutes) => (
            <Pressable
              key={minutes}
              onPress={() => {
                setDurationMinutes(minutes);
                setSelectedServiceId("");
              }}
              style={[
                styles.durationChip,
                {
                  backgroundColor:
                    durationMinutes === minutes
                      ? colors.primary
                      : colors.background,
                  borderColor:
                    durationMinutes === minutes
                      ? colors.primary
                      : colors.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: durationMinutes === minutes ? "#FFFFFF" : colors.text },
                ]}
              >
                {minutes} min
              </Text>
            </Pressable>
          ))}
        </View>
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

      <AppButton title="Add to my schedule" loading={saving} onPress={() => void save()} />
      <Text style={[styles.helperText, { color: colors.mutedText }]}>
        We will create the client and service automatically when needed.
      </Text>
      <AppButton
        title="I'll do this later"
        variant="ghost"
        disabled={saving}
        onPress={confirmSkip}
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
  valueLabel: { fontSize: 12, fontWeight: "800", marginTop: 6, textAlign: "center" },
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
  fieldLabel: { fontWeight: "800", marginBottom: 9 },
  durationChip: {
    borderRadius: 12,
    borderWidth: 1,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  helperText: { fontSize: 13, lineHeight: 19, marginTop: 10, textAlign: "center" },
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
