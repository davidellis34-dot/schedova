import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dropdown } from "react-native-element-dropdown";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import {
  AndroidTabletSmsFallbackSheet,
  type AndroidTabletSmsFallback,
} from "../components/AndroidTabletSmsFallbackSheet";
import { blockTitleFor, normalizeId } from "../components/booking/bookingUtils";
import { DatePickerField } from "../components/booking/DatePickerField";
import { DurationStepper } from "../components/booking/DurationStepper";
import { EntryTypePicker } from "../components/booking/EntryTypePicker";
import { PickerBox } from "../components/booking/PickerBox";
import { QuickClientModal } from "../components/booking/QuickClientModal";
import { QuickServiceModal } from "../components/booking/QuickServiceModal";
import { SelectedServicesList } from "../components/booking/SelectedServicesList";
import { TimeDropdown } from "../components/booking/TimeDropdown";
import type { ThemeColors } from "../components/booking/types";
import { useBookAppointmentForm } from "../components/booking/useBookAppointmentForm";
import { AppButton, AppCard, AppScreen, ScreenHeader } from "../components/ui";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { copyTextToClipboard } from "../lib/clipboard";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import {
  BUILT_IN_MESSAGE_TEMPLATES,
  fetchCustomMessageTemplates,
  renderMessageTemplate,
  type MessageTemplate,
} from "../lib/messageTemplates";
import {
  PRO_UPSELL_COPY,
  showProUpgradePrompt,
  showProUpgradePromptForFlow,
} from "../lib/proUpsell";
import { buildSchedovaBookingLink } from "../lib/schedovaLinks";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const FALLBACK_COLORS: ThemeColors = {
  background: "#FFFFFF",
  card: "#F8FAFC",
  text: "#111827",
  mutedText: "#6B7280",
  border: "#E5E7EB",
  primary: "#0F766E",
};

const isTablet = Dimensions.get("window").width >= 768;
const ANDROID_TABLET_MIN_SHORT_SIDE = 600;

function isAndroidTablet() {
  if (Platform.OS !== "android") return false;

  const { width, height } = Dimensions.get("screen");
  return Math.min(width, height) >= ANDROID_TABLET_MIN_SHORT_SIDE;
}

function textInputStyle(colors: ThemeColors) {
  return {
    backgroundColor: colors.background,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    fontSize: 16,
    fontWeight: "600" as const,
    minHeight: 54,
    marginBottom: 18,
  };
}

function SectionHeading({
  title,
  subtitle,
  colors,
  accentColor,
  accentSoft,
}: {
  title: string;
  subtitle?: string;
  colors: ThemeColors;
  accentColor?: string;
  accentSoft?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            backgroundColor: accentSoft || colors.card,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 1,
          }}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 999,
              backgroundColor: accentColor || colors.primary,
            }}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 19,
              fontWeight: "900",
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
                marginTop: 5,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

type AppointmentMessageClient = {
  id: string;
  name: string | null;
  phone: string | null;
  phone_number?: string | null;
  phoneNumber?: string | null;
  sms_opt_in: boolean | null;
};

function formatTemplateDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTemplateTime(value?: string | null) {
  if (!value) return null;

  const [hoursText, minutesText = "00"] = value.split(":");
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

function normalizePhoneNumber(phone?: string | null) {
  if (!phone) return "";

  const trimmed = String(phone).trim();
  if (!trimmed) return "";

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");

  if (!digits) return "";

  return hasPlus ? `+${digits}` : digits;
}

function getClientPhone(client: any, appointment?: any) {
  return (
    client?.phone ||
    client?.phone_number ||
    client?.phoneNumber ||
    appointment?.client_phone ||
    appointment?.clients?.phone ||
    appointment?.clients?.phone_number ||
    ""
  );
}

function getTemplateBody(template: any) {
  return template?.body || template?.message || template?.content || "";
}

function buildSmsUrls(phone: string, message: string) {
  const encodedBody = encodeURIComponent(message || "");

  if (Platform.OS === "android") {
    return [
      `smsto:${phone}?body=${encodedBody}`,
      `sms:${phone}?body=${encodedBody}`,
      `sms:${phone};?body=${encodedBody}`,
    ];
  }

  return [
    `sms:${phone}&body=${encodedBody}`,
    `sms:${phone}?body=${encodedBody}`,
  ];
}

async function openSmsComposer(
  rawPhone: string | null | undefined,
  message: string | null | undefined,
  options: { logSend?: boolean } = {},
) {
  const phone = normalizePhoneNumber(rawPhone);
  const messageBody = String(message || "").trim();

  if (options.logSend !== false) {
    console.log("SMS template send", { rawPhone, messageBody });
  }

  if (!phone) {
    Alert.alert(
      "Missing phone number",
      "Add a phone number for this client before sending a message.",
    );
    return;
  }

  if (!messageBody) {
    Alert.alert(
      "Missing message",
      "Choose or create a message template before sending.",
    );
    return;
  }

  const urls = buildSmsUrls(phone, messageBody);
  let lastError: unknown = null;

  for (const url of urls) {
    try {
      const canOpen = await Linking.canOpenURL(url);

      if (canOpen) {
        await Linking.openURL(url);
        return;
      }
    } catch (error) {
      lastError = error;
    }
  }

  console.log("Failed to open SMS composer", {
    phone,
    messageBody,
    urls,
    lastError,
  });

  Alert.alert(
    "Cannot open messages",
    "No messaging app is available, or this device does not support prefilled SMS messages.",
  );
}

function prepareAndroidTabletSmsFallback(
  rawPhone: string | null | undefined,
  message: string | null | undefined,
): AndroidTabletSmsFallback | null {
  const phone = normalizePhoneNumber(rawPhone);
  const messageBody = String(message || "").trim();

  console.log("SMS template send", { rawPhone, messageBody });

  if (!phone) {
    Alert.alert(
      "Missing phone number",
      "Add a phone number for this client before sending a message.",
    );
    return null;
  }

  if (!messageBody) {
    Alert.alert(
      "Missing message",
      "Choose or create a message template before sending.",
    );
    return null;
  }

  const clientPhone = String(rawPhone || phone).trim();

  return {
    rawPhone: clientPhone,
    messageBody,
    fallbackText: messageBody,
  };
}

export default function BookAppointmentScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  useFeatureAccess();
  const colors: ThemeColors = { ...FALLBACK_COLORS, ...(theme?.colors || {}) };
  const form = useBookAppointmentForm({
    requestProAccess: (message) =>
      showProUpgradePromptForFlow(message || PRO_UPSELL_COPY.freeLimit),
  });
  const customScheduleAvailable = canUseFeature("customBusinessHours");
  const [showEntryTypeProPrompt, setShowEntryTypeProPrompt] = useState(false);
  const [messageModalVisible, setMessageModalVisible] = useState(false);
  const [messageTemplatesLoading, setMessageTemplatesLoading] = useState(false);
  const [messageTemplates, setMessageTemplates] = useState<MessageTemplate[]>(
    BUILT_IN_MESSAGE_TEMPLATES,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    BUILT_IN_MESSAGE_TEMPLATES[0]?.id ?? "",
  );
  const [appointmentMessageClient, setAppointmentMessageClient] =
    useState<AppointmentMessageClient | null>(null);
  const [androidTabletSmsFallback, setAndroidTabletSmsFallback] =
    useState<AndroidTabletSmsFallback | null>(null);

  const clientDropdownData = useMemo(
    () =>
      Array.isArray(form.clientDropdownData)
        ? form.clientDropdownData.filter(
            (clientOption) =>
              clientOption &&
              typeof clientOption.label === "string" &&
              normalizeId(clientOption.value),
          )
        : [],
    [form.clientDropdownData],
  );
  const serviceDropdownData = useMemo(
    () =>
      Array.isArray(form.serviceDropdownData)
        ? form.serviceDropdownData.filter(
            (serviceOption) =>
              serviceOption &&
              typeof serviceOption.label === "string" &&
              normalizeId(serviceOption.value),
          )
        : [],
    [form.serviceDropdownData],
  );
  const selectedServices = useMemo(
    () =>
      Array.isArray(form.selectedServices)
        ? form.selectedServices.filter(
            (service) => service && normalizeId(service.id),
          )
        : [],
    [form.selectedServices],
  );

  const selectedClientLabel =
    clientDropdownData.find(
      (clientOption) => normalizeId(clientOption.value) === form.selectedClient,
    )?.label || "Client";
  const selectedTemplate =
    messageTemplates.find((template) => template.id === selectedTemplateId) ||
    messageTemplates[0] ||
    null;
  const renderedAppointmentMessage = useMemo(() => {
    if (!selectedTemplate) return "";

    const serviceNames = selectedServices
      .map((service) => service.name)
      .filter(Boolean)
      .join(", ");
    const addToSchedovaLink =
      form.appointmentDate && form.startTime
        ? buildSchedovaBookingLink({
            clientId: form.selectedClient,
            date: form.appointmentDate,
            time: form.startTime.slice(0, 5),
            serviceId: selectedServices[0]?.id,
            source: "message",
          })
        : null;

    return renderMessageTemplate(getTemplateBody(selectedTemplate), {
      client_name:
        appointmentMessageClient?.name?.trim() || selectedClientLabel || "Client",
      appointment_date: formatTemplateDate(form.appointmentDate),
      appointment_time: formatTemplateTime(form.startTime),
      service_name: serviceNames || null,
      business_name: "your business",
      add_to_schedova_link: addToSchedovaLink,
    });
  }, [
    appointmentMessageClient?.name,
    form.appointmentDate,
    form.selectedClient,
    form.startTime,
    selectedClientLabel,
    selectedServices,
    selectedTemplate,
  ]);

  async function openAppointmentMessageClient() {
    if (!canUseFeature("unlimitedMessageTemplates")) {
      showProUpgradePrompt(PRO_UPSELL_COPY.messageTemplates);
      return;
    }

    if (!form.selectedClient) {
      Alert.alert("Select a client", "Select a client before messaging.");
      return;
    }

    setMessageModalVisible(true);
    setMessageTemplatesLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert("Not signed in", "Please sign in again.");
        return;
      }

      const [customTemplates, { data: clientData }] = await Promise.all([
        fetchCustomMessageTemplates(user.id),
        supabase
          .from("clients")
          .select("*")
          .eq("id", form.selectedClient)
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);
      const nextTemplates = [
        ...BUILT_IN_MESSAGE_TEMPLATES,
        ...customTemplates,
      ];

      setMessageTemplates(nextTemplates);
      setSelectedTemplateId(
        (currentId) => currentId || nextTemplates[0]?.id || "",
      );
      setAppointmentMessageClient(
        (clientData as AppointmentMessageClient | null) ?? {
          id: form.selectedClient,
          name: selectedClientLabel,
          phone: null,
          sms_opt_in: false,
        },
      );
    } catch (error) {
      console.log("APPOINTMENT MESSAGE TEMPLATE LOAD ERROR:", error);
      setMessageTemplates(BUILT_IN_MESSAGE_TEMPLATES);
    } finally {
      setMessageTemplatesLoading(false);
    }
  }

  async function copyAppointmentMessage() {
    if (!renderedAppointmentMessage) return;

    try {
      await copyTextToClipboard(renderedAppointmentMessage);
    } catch (error) {
      console.error("Clipboard copy failed:", error);
      Alert.alert("Copy failed", "Unable to copy message. Please try again.");
    }
  }

  async function openAppointmentSmsUrl(phoneNumber: string, logSend = true) {
    await openSmsComposer(phoneNumber, renderedAppointmentMessage, { logSend });
  }

  async function openAppointmentSmsWithTabletFallback(phoneNumber: string) {
    if (isAndroidTablet()) {
      const fallback = prepareAndroidTabletSmsFallback(
        phoneNumber,
        renderedAppointmentMessage,
      );

      if (fallback) {
        setAndroidTabletSmsFallback(fallback);
      }

      return;
    }

    await openAppointmentSmsUrl(phoneNumber);
  }

  async function copyAndroidTabletSmsFallback() {
    if (!androidTabletSmsFallback) return;

    try {
      await copyTextToClipboard(androidTabletSmsFallback.fallbackText);
      setAndroidTabletSmsFallback(null);
    } catch (copyError) {
      console.log("SMS fallback copy failed", copyError);
      Alert.alert("Copy failed", "Unable to copy message.");
    }
  }

  async function shareAndroidTabletSmsFallback() {
    if (!androidTabletSmsFallback) return;

    try {
      await Share.share({ message: androidTabletSmsFallback.fallbackText });
      setAndroidTabletSmsFallback(null);
    } catch (shareError) {
      console.log("SMS fallback share failed", shareError);
    }
  }

  async function openAndroidTabletMessagesAnyway() {
    const fallback = androidTabletSmsFallback;
    setAndroidTabletSmsFallback(null);

    if (!fallback) return;

    await openSmsComposer(fallback.rawPhone, fallback.messageBody, {
      logSend: false,
    });
  }

  async function openAppointmentSmsApp() {
    const phoneNumber = getClientPhone(appointmentMessageClient);

    if (!normalizePhoneNumber(phoneNumber)) {
      await openAppointmentSmsUrl(phoneNumber);
      return;
    }

    if (!appointmentMessageClient?.sms_opt_in) {
      Alert.alert(
        "SMS opt-in required",
        "This client has not opted in to appointment texts.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open SMS App",
            onPress: () => {
              void openAppointmentSmsWithTabletFallback(phoneNumber);
            },
          },
        ],
      );
      return;
    }

    await openAppointmentSmsWithTabletFallback(phoneNumber);
  }

  async function handleDeleteAppointment() {
    const appointmentId = form.appointmentId;

    if (!appointmentId) return;

    await confirmDestructiveAction({
      title: "Delete Appointment",
      message: "This appointment will be permanently deleted.",
      confirmText: "Delete",
      onConfirm: async () => {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          Alert.alert("Not signed in", "Please sign in again.");
          return;
        }

        if (canUseFeature("smsAutomation")) {
          await sendAppointmentSmsNonBlocking(appointmentId, "cancellation");
        }

        const { error } = await supabase
          .from("appointments")
          .delete()
          .eq("id", appointmentId)
          .eq("user_id", user.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }

        await cancelAppointmentReminder(appointmentId);
        router.replace("/calendar-view" as any);
      },
    });
  }

  const isDarkMode =
    theme.themeName === "dark" ||
    theme.themeName === "black" ||
    colors.background === "#111827" ||
    colors.background === "#0F172A";

  const infoAccent = isDarkMode ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkMode
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkMode
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkMode
    ? "rgba(15, 118, 110, 0.28)"
    : "rgba(15, 118, 110, 0.12)";
  const polishedBorder = isDarkMode
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const fieldBackground = isDarkMode ? "#172033" : "#FFFFFF";
  const dropdownBackground = fieldBackground;
  const dropdownText = isDarkMode ? "#FFFFFF" : colors.text;
  const cardStyle = {
    marginBottom: 16,
    borderColor: polishedBorder,
  };
  const infoCardStyle = {
    ...cardStyle,
    borderLeftWidth: 4,
    borderLeftColor: infoAccent,
  };
  const primaryCardStyle = {
    ...cardStyle,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
  };
  const subtleInfoPanelStyle = {
    backgroundColor: infoAccentSoft,
    borderWidth: 1,
    borderColor: infoAccentBorder,
    borderRadius: 14,
    padding: 14,
  };

  const dropdownBoxStyle = {
    minHeight: 56,
    width: "100%" as const,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: dropdownBackground,
    borderRadius: 14,
    justifyContent: "center" as const,
  };

  const inputStyle = {
    ...textInputStyle(colors),
    backgroundColor: fieldBackground,
    borderColor: polishedBorder,
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppScreen
        scroll
        keyboardAware
        backgroundColor={colors.background}
        horizontalPadding={isTablet ? 24 : 16}
        topPadding={isTablet ? 24 : 14}
        bottomPadding={96}
        androidBottomPadding={140}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "none"}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          title={
            form.isRescheduleMode
              ? "Reschedule Appointment"
              : form.isEditMode
                ? "Edit Appointment"
                : "Book Appointment"
          }
          subtitle="Schedule client time with services, notes, and appointment details."
        />

        <AppCard style={infoCardStyle}>
          <SectionHeading
            title="Entry type"
            subtitle={
              form.entryType === "appointment"
                ? "Choose the kind of calendar entry to create."
                : blockTitleFor(form.entryType)
            }
            colors={colors}
            accentColor={infoAccent}
            accentSoft={infoAccentSoft}
          />

          <EntryTypePicker
            value={form.entryType}
            onChange={async (nextEntryType) => {
              if (
                nextEntryType !== "appointment" &&
                !customScheduleAvailable
              ) {
                if (ENABLE_PRO) {
                  setShowEntryTypeProPrompt(true);
                  showProUpgradePrompt(
                    nextEntryType === "vacation"
                      ? PRO_UPSELL_COPY.vacationBlocks
                      : nextEntryType === "blocked_time"
                        ? PRO_UPSELL_COPY.blockedTime
                        : PRO_UPSELL_COPY.customBusinessHours,
                  );
                }

                return;
              }

              setShowEntryTypeProPrompt(false);
              form.setEntryType(nextEntryType);
            }}
            colors={colors}
            proLocked={!customScheduleAvailable}
          />

          {ENABLE_PRO && showEntryTypeProPrompt && !customScheduleAvailable ? (
            <View
              style={{
                ...subtleInfoPanelStyle,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>
                Schedova Pro
              </Text>
              <Text style={{ color: colors.mutedText, marginTop: 6, lineHeight: 20 }}>
                Blocked time, vacation blocks, and custom business hours are
                included with Schedova Pro.
              </Text>
            </View>
          ) : null}
        </AppCard>

        {form.entryType === "appointment" ? (
          <>
            <AppCard style={primaryCardStyle}>
              <SectionHeading
                title="Client"
                subtitle="Select an existing client or quickly add a new one."
                colors={colors}
                accentColor={colors.primary}
                accentSoft={greenAccentSoft}
              />

              <PickerBox
                label="Client"
                colors={colors}
                accentColor={polishedBorder}
                backgroundColor={fieldBackground}
              >
                <Dropdown
                  selectedTextStyle={{
                    color: dropdownText,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                  maxHeight={300}
                  showsVerticalScrollIndicator={false}
                  data={clientDropdownData}
                  search
                  searchPlaceholder="Search clients..."
                  labelField="label"
                  valueField="value"
                  value={form.selectedClient || null}
                  selectedTextProps={{ numberOfLines: 1 }}
                  placeholder="Select client"
                  placeholderStyle={{
                    color: dropdownText,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                  itemTextStyle={{
                    color: dropdownText,
                    fontSize: 16,
                  }}
                  containerStyle={{
                    backgroundColor: dropdownBackground,
                    borderColor: colors.border,
                    borderRadius: 12,
                    zIndex: 999,
                    elevation: 10,
                  }}
                  activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
                  flatListProps={{
                    keyboardShouldPersistTaps: "handled",
                  }}
                  style={[
                    dropdownBoxStyle,
                    {
                      minHeight: 52,
                    },
                  ]}
                  onChange={(item: any) => {
                    if (item?.value === "new_client") {
                      form.setShowQuickClient(true);
                      return;
                    }

                    form.setSelectedClient(normalizeId(item?.value));
                  }}
                />
              </PickerBox>
            </AppCard>

            <AppCard style={primaryCardStyle}>
              <SectionHeading
                title="Services"
                subtitle="Add one or more services for this appointment."
                colors={colors}
                accentColor={colors.primary}
                accentSoft={greenAccentSoft}
              />

              <PickerBox
                label="Services"
                colors={colors}
                accentColor={polishedBorder}
                backgroundColor={fieldBackground}
              >
                <Dropdown
                  maxHeight={300}
                  showsVerticalScrollIndicator={false}
                  data={serviceDropdownData}
                  labelField="label"
                  valueField="value"
                  value={null}
                  selectedTextProps={{ numberOfLines: 1 }}
                  placeholder="Select service"
                  placeholderStyle={{
                    color: dropdownText,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                  selectedTextStyle={{
                    color: dropdownText,
                    fontSize: 16,
                    fontWeight: "700",
                  }}
                  itemTextStyle={{
                    color: dropdownText,
                    fontSize: 15,
                  }}
                  containerStyle={{
                    backgroundColor: dropdownBackground,
                    borderColor: colors.border,
                    borderRadius: 12,
                    zIndex: 999,
                    elevation: 10,
                  }}
                  activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
                  flatListProps={{
                    keyboardShouldPersistTaps: "handled",
                  }}
                  style={dropdownBoxStyle}
                  onChange={(item: any) => {
                    if (item?.value === "new_service") {
                      form.setShowQuickService(true);
                      return;
                    }

                    const picked = form.services.find(
                      (service) =>
                        normalizeId(service?.id) === normalizeId(item?.value),
                    );

                    if (picked) form.addServiceToAppointment(picked);
                  }}
                />
              </PickerBox>

              <SelectedServicesList
                services={form.selectedServices}
                colors={colors}
                onRemove={form.removeSelectedService}
              />
              {selectedServices.length > 0 ? (
                <DurationStepper
                  durationMinutes={form.appointmentDurationMinutes}
                  defaultMinutes={form.defaultAppointmentDurationMinutes}
                  onChange={form.setAppointmentDurationMinutes}
                  colors={colors}
                />
              ) : null}
            </AppCard>
          </>
        ) : (
          <AppCard style={infoCardStyle}>
            <SectionHeading
              title="Details"
              subtitle="Add a clear title for this calendar entry."
              colors={colors}
              accentColor={infoAccent}
              accentSoft={infoAccentSoft}
            />
            <TextInput
              value={form.title}
              onChangeText={form.setTitle}
              placeholder={`${blockTitleFor(form.entryType)} title`}
              placeholderTextColor={colors.mutedText}
              style={inputStyle}
            />
          </AppCard>
        )}

        <AppCard style={infoCardStyle}>
          <SectionHeading
            title="Date and time"
            subtitle="Choose when this entry should appear on your calendar."
            colors={colors}
            accentColor={infoAccent}
            accentSoft={infoAccentSoft}
          />

          <DatePickerField
            colors={colors}
            value={form.appointmentDate}
            onChange={form.setAppointmentDate}
            isTablet={isTablet}
          />

          {form.entryType !== "appointment" && (
            <View
              style={{
                backgroundColor: fieldBackground,
                borderWidth: 1,
                borderColor: polishedBorder,
                borderRadius: 14,
                padding: 14,
                marginBottom: 12,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "800" }}>
                All Day
              </Text>

              <Switch value={form.allDay} onValueChange={form.setAllDay} />
            </View>
          )}

          {!form.allDay && (
            <>
              <TimeDropdown
                label="Start Time"
                value={form.startTime}
                onChange={(value) => {
                  form.setStartTime(value);
                }}
                colors={colors}
                use24Hour={form.use24Hour}
                intervalMinutes={form.calendarIntervalMinutes}
                marginTop={8}
              />

              <TimeDropdown
                label="End Time"
                value={form.endTime}
                onChange={(value) => {
                  form.setEndTimeFromPicker(value);
                }}
                colors={colors}
                use24Hour={form.use24Hour}
                intervalMinutes={form.calendarIntervalMinutes}
                marginTop={16}
                helperText="Auto-calculated from duration"
              />
            </>
          )}

          <PickerBox
            label="Repeat"
            colors={colors}
            accentColor={polishedBorder}
            backgroundColor={fieldBackground}
          >
            <Dropdown
              maxHeight={300}
              showsVerticalScrollIndicator={false}
              data={[
                { label: "Never", value: "none" },
                { label: "Daily", value: "daily" },
                { label: "Weekly", value: "weekly" },
                { label: "Every 2 Weeks", value: "biweekly" },
                { label: "Monthly", value: "monthly" },
              ]}
              labelField="label"
              valueField="value"
              value={form.repeatType}
              onChange={(item: any) => form.setRepeatType(item.value)}
              selectedTextProps={{ numberOfLines: 1 }}
              placeholder="Never"
              placeholderStyle={{
                color: dropdownText,
                fontSize: 16,
                fontWeight: "700",
              }}
              selectedTextStyle={{
                color: dropdownText,
                fontSize: 16,
                fontWeight: "700",
              }}
              itemTextStyle={{
                color: dropdownText,
                fontSize: 15,
              }}
              containerStyle={{
                backgroundColor: dropdownBackground,
                borderColor: colors.border,
                borderRadius: 12,
                zIndex: 999,
                elevation: 10,
              }}
              activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
              flatListProps={{
                keyboardShouldPersistTaps: "handled",
              }}
              style={dropdownBoxStyle}
            />
          </PickerBox>

          {form.repeatType !== "none" && (
            <DatePickerField
              colors={colors}
              value={form.repeatUntil}
              onChange={form.setRepeatUntil}
              isTablet={isTablet}
            />
          )}
        </AppCard>

        {form.entryType === "appointment" && (
          <AppCard style={infoCardStyle}>
            <SectionHeading
              title="Notes and price"
              subtitle="Add final price and any useful appointment details."
              colors={colors}
              accentColor={infoAccent}
              accentSoft={infoAccentSoft}
            />

            <Text
              style={{
                color: colors.text,
                fontWeight: "800",
                marginBottom: 8,
              }}
            >
              Final Price
            </Text>

            <TextInput
              value={form.finalPrice}
              onChangeText={form.setFinalPrice}
              placeholder="Final price"
              placeholderTextColor={colors.mutedText}
              keyboardType="decimal-pad"
              style={inputStyle}
            />

            <Text
              style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}
            >
              Notes
            </Text>

            <TextInput
              value={form.appointmentNotes}
              onChangeText={form.setAppointmentNotes}
              placeholder="Appointment notes"
              placeholderTextColor={colors.mutedText}
              multiline
              textAlignVertical="top"
              style={[inputStyle, { minHeight: 110, marginBottom: 0 }]}
            />
          </AppCard>
        )}

        {form.entryType === "appointment" ? (
          <AppCard style={infoCardStyle}>
            <SectionHeading
              title="Message client"
              subtitle="Use a saved template, then copy it or open your SMS app."
              colors={colors}
              accentColor={infoAccent}
              accentSoft={infoAccentSoft}
            />
            <AppButton
              title="Message Client"
              variant="secondary"
              onPress={() => {
                void openAppointmentMessageClient();
              }}
            />
          </AppCard>
        ) : null}

        <AppButton
          title={form.saving ? "Saving..." : "Save Calendar Entry"}
          loading={form.saving}
          disabled={form.saving || form.loading}
          onPress={async () => {
            if (form.saving || form.loading) return;

            const saved = await form.saveEntry();

            if (saved) {
              void Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success,
              ).catch(() => {});
            }
          }}
          style={{ marginTop: 12, marginBottom: 10 }}
        />

        {form.isEditMode && form.appointmentId ? (
          <AppButton
            title="Delete Appointment"
            variant="destructive"
            onPress={() => {
              void Haptics.impactAsync(
                Haptics.ImpactFeedbackStyle.Medium,
              ).catch(() => {});

              void handleDeleteAppointment();
            }}
            style={{ marginBottom: 10 }}
          />
        ) : null}

        <AppButton
          title="Cancel"
          variant="ghost"
          onPress={() => router.back()}
          style={{ marginTop: 4 }}
        />
      </AppScreen>

      <QuickClientModal
        visible={form.showQuickClient}
        colors={colors}
        name={form.newClientName}
        phone={form.newClientPhone}
        email={form.newClientEmail}
        onChangeName={form.setNewClientName}
        onChangePhone={form.setNewClientPhone}
        onChangeEmail={form.setNewClientEmail}
        onCancel={() => form.setShowQuickClient(false)}
        onSave={form.saveQuickClient}
      />

      <QuickServiceModal
        visible={form.showQuickService}
        colors={colors}
        name={form.newServiceName}
        price={form.newServicePrice}
        duration={form.newServiceDuration}
        onChangeName={form.setNewServiceName}
        onChangePrice={form.setNewServicePrice}
        onChangeDuration={form.setNewServiceDuration}
        onCancel={() => form.setShowQuickService(false)}
        onSaved={(service: any) => {
          form.addServiceToAppointment(service);
          form.setShowQuickService(false);
        }}
        userId={form.userId}
      />

      <Modal
        visible={messageModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMessageModalVisible(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0, 0, 0, 0.58)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: "88%",
              padding: 18,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 14,
                marginBottom: 14,
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
                  Message Client
                </Text>
                <Text
                  style={{
                    color: colors.mutedText,
                    lineHeight: 20,
                    marginTop: 6,
                  }}
                >
                  Pick a template, preview it, then copy it or open your SMS app.
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close message client"
                onPress={() => setMessageModalVisible(false)}
                hitSlop={10}
              >
                <Text
                  style={{
                    color: colors.mutedText,
                    fontSize: 22,
                    fontWeight: "900",
                  }}
                >
                  X
                </Text>
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <AppCard style={{ marginBottom: 12 }}>
                <Text style={{ color: colors.text, fontWeight: "900" }}>
                  SMS opt-in
                </Text>
                <Text
                  style={{
                    color: appointmentMessageClient?.sms_opt_in
                      ? colors.mutedText
                      : "#F59E0B",
                    lineHeight: 20,
                    marginTop: 6,
                  }}
                >
                  {appointmentMessageClient?.sms_opt_in
                    ? "Client agreed to appointment texts."
                    : "This client has not opted in to appointment texts."}
                </Text>
              </AppCard>

              <Text
                style={{
                  color: colors.text,
                  fontWeight: "900",
                  marginBottom: 10,
                }}
              >
                Templates
              </Text>

              {messageTemplatesLoading ? (
                <AppCard style={{ marginBottom: 12 }}>
                  <Text style={{ color: colors.mutedText }}>
                    Loading templates...
                  </Text>
                </AppCard>
              ) : null}

              {!messageTemplatesLoading && messageTemplates.length === 0 ? (
                <AppCard style={{ marginBottom: 12 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontWeight: "900",
                      marginBottom: 6,
                    }}
                  >
                    No templates yet
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedText,
                      lineHeight: 20,
                      marginBottom: 12,
                    }}
                  >
                    Create a template in Settings to reuse messages with clients.
                  </Text>
                  <AppButton
                    title="Create Template"
                    onPress={() => {
                      setMessageModalVisible(false);
                      router.push("/settings/message-templates" as any);
                    }}
                  />
                </AppCard>
              ) : null}

              <View style={{ gap: 10, marginBottom: 12 }}>
                {messageTemplates.map((template) => {
                  const selected = template.id === selectedTemplate?.id;

                  return (
                    <AppCard
                      key={template.id}
                      onPress={() => setSelectedTemplateId(template.id)}
                      style={{
                        borderColor: selected ? colors.primary : colors.border,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 12,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text
                            style={{
                              color: colors.text,
                              fontWeight: "900",
                            }}
                          >
                            {template.title}
                          </Text>
                          <Text
                            numberOfLines={2}
                            style={{
                              color: colors.mutedText,
                              lineHeight: 18,
                              marginTop: 4,
                            }}
                          >
                            {getTemplateBody(template)}
                          </Text>
                        </View>
                        <Text
                          style={{
                            color: selected ? colors.primary : colors.mutedText,
                            fontWeight: "900",
                          }}
                        >
                          {selected ? "Selected" : "Use"}
                        </Text>
                      </View>
                    </AppCard>
                  );
                })}
              </View>

              <AppCard style={{ marginBottom: 12 }}>
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "900",
                    marginBottom: 8,
                  }}
                >
                  Preview
                </Text>
                <Text style={{ color: colors.text, lineHeight: 22 }}>
                  {renderedAppointmentMessage ||
                    "Select a template to preview it."}
                </Text>
              </AppCard>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 10,
                  paddingBottom: 14,
                }}
              >
                <AppButton
                  title="Copy Message"
                  onPress={() => {
                    void copyAppointmentMessage();
                  }}
                  fullWidth={false}
                  style={{ flexGrow: 1, flexBasis: 150 }}
                />
                <AppButton
                  title="Open SMS App"
                  variant="secondary"
                  onPress={() => {
                    void openAppointmentSmsApp();
                  }}
                  fullWidth={false}
                  style={{ flexGrow: 1, flexBasis: 150 }}
                />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AndroidTabletSmsFallbackSheet
        visible={Boolean(androidTabletSmsFallback)}
        onCancel={() => setAndroidTabletSmsFallback(null)}
        onCopy={() => {
          void copyAndroidTabletSmsFallback();
        }}
        onOpenMessages={() => {
          void openAndroidTabletMessagesAnyway();
        }}
        onShare={() => {
          void shareAndroidTabletSmsFallback();
        }}
      />
    </GestureHandlerRootView>
  );
}
