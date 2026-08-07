import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ContextTip,
  EmptyState,
  ScreenHeader,
  SuccessToast,
} from "../components/ui";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { FREE_TIER_LIMITS } from "../lib/freePlanLimits";
import { PRO_UPSELL_COPY, showProUpgradePrompt } from "../lib/proUpsell";
import {
  getSavePerformanceNow,
  logSaveTiming,
  measureSaveStep,
} from "../lib/savePerformance";
import { settleActiveTextInput } from "../lib/settleTextInputs";
import { supabase } from "../lib/supabase";
import { useTrackedTextInputValue } from "../lib/textInputDraft";
import { useAppTheme } from "../lib/useAppTheme";
import { useAuthSession } from "../lib/authSession";
import { trackAnalyticsEvent } from "../lib/analytics";

type ServiceRecord = {
  id: string;
  name?: string | null;
  price?: number | string | null;
  duration_minutes?: number | string | null;
  color_hex?: string | null;
  rebooking_interval_value?: number | string | null;
  rebooking_interval_unit?: "days" | "weeks" | "months" | null;
};

const DEFAULT_SERVICE_COLOR = "#0F766E";
const SERVICE_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

function isServiceRecord(value: unknown): value is ServiceRecord {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as { id?: unknown }).id === "string" &&
    (value as { id: string }).id.trim(),
  );
}

function normalizeServiceName(service: ServiceRecord | null | undefined) {
  const serviceName = String(service?.name || "").trim();
  return serviceName || "Untitled service";
}

function normalizeServiceColor(value: unknown) {
  const color = String(value || "").trim();
  return SERVICE_COLOR_PATTERN.test(color) ? color : DEFAULT_SERVICE_COLOR;
}

function formatServicePrice(value: unknown) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount < 0) {
    return "Price not set";
  }

  return amount % 1 === 0 ? `$${amount}` : `$${amount.toFixed(2)}`;
}

function formatServiceDuration(value: unknown) {
  const minutes = Number(value);

  if (!Number.isFinite(minutes) || minutes <= 0) {
    return "Duration not set";
  }

  const roundedMinutes = Math.round(minutes);
  return `${roundedMinutes} ${roundedMinutes === 1 ? "min" : "mins"}`;
}

export default function AddServiceScreen() {
  const { userId } = useAuthSession();
  useFeatureAccess();
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const nameField = useTrackedTextInputValue("");
  const priceField = useTrackedTextInputValue("");
  const durationField = useTrackedTextInputValue("");
  const [colorHex, setColorHex] = useState(DEFAULT_SERVICE_COLOR);
  const rebookingIntervalValueField = useTrackedTextInputValue("");
  const [rebookingIntervalUnit, setRebookingIntervalUnit] = useState<
    "days" | "weeks" | "months"
  >("weeks");
  const { colors, themeName } = useAppTheme();
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.34)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.26)"
    : "rgba(15, 118, 110, 0.12)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";
  const destructiveSoft = isDarkTheme
    ? "rgba(220, 38, 38, 0.18)"
    : "rgba(220, 38, 38, 0.10)";
  const destructiveBorder = isDarkTheme
    ? "rgba(248, 113, 113, 0.36)"
    : "rgba(220, 38, 38, 0.22)";
  const serviceColors = [
    DEFAULT_SERVICE_COLOR,
    "#2563EB",
    "#7C3AED",
    "#DC2626",
    "#EA580C",
    "#DB2777",
    "#111827",
    "#CA8A04",
    "#92400E",
    "#0891B2",
  ];
  const [showForm, setShowForm] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);
  const [services, setServices] = useState<ServiceRecord[]>([]);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);

  async function handleSave() {
    if (saving) return;

    await settleActiveTextInput();

    const flowName = `service save (${editingServiceId ? "edit" : "create"})`;
    const saveStartedAt = getSavePerformanceNow();
    const validationStartedAt = getSavePerformanceNow();
    let postSupabaseStartedAt: number | null = null;
    const isFirstService = !editingServiceId && services.length === 0;
    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      let currentUserId = userId || "";

      if (currentUserId) {
        logSaveTiming(flowName, "auth lookup", 0, {
          source: "cached_user_id",
        });
      } else {
        const { data: userData } = await measureSaveStep(
          flowName,
          "auth lookup",
          () => supabase.auth.getUser(),
        );
        currentUserId = userData.user?.id || "";
      }

      if (!currentUserId) {
        const message = "Please log in first.";
        setErrorMessage(message);
        Alert.alert("Login Required", message);
        return;
      }

      const trimmedName = nameField.getValue().trim();
      const livePrice = priceField.getValue();
      const liveDuration = durationField.getValue();
      const liveRebookingIntervalValue = rebookingIntervalValueField.getValue();

      if (!trimmedName || !livePrice || !liveDuration) {
        const message = "Please fill out all fields.";
        setErrorMessage(message);
        Alert.alert("Missing Info", message);
        return;
      }

      const priceNumber = Number(livePrice);
      const durationNumber = Number(liveDuration);
      const intervalValue = liveRebookingIntervalValue.trim()
        ? Number(liveRebookingIntervalValue)
        : null;

      if (!Number.isFinite(priceNumber) || priceNumber < 0) {
        const message = "Price must be zero or higher.";
        setErrorMessage(message);
        Alert.alert("Invalid Price", message);
        return;
      }

      if (!Number.isFinite(durationNumber) || durationNumber <= 0) {
        const message = "Duration must be greater than zero.";
        setErrorMessage(message);
        Alert.alert("Invalid Duration", message);
        return;
      }

      if (
        intervalValue !== null &&
        (!Number.isInteger(intervalValue) || intervalValue <= 0)
      ) {
        const message = "Rebooking interval must be a whole number greater than zero.";
        setErrorMessage(message);
        Alert.alert("Invalid Rebooking Interval", message);
        return;
      }

      logSaveTiming(
        flowName,
        "validation",
        getSavePerformanceNow() - validationStartedAt,
      );

      if (
        !editingServiceId &&
        !canUseFeature("moreServices") &&
        services.length >= FREE_TIER_LIMITS.services
      ) {
        showProUpgradePrompt(PRO_UPSELL_COPY.moreServices);
        return;
      }

      let error;
      let savedService: ServiceRecord | null = null;
      const mutationStartedAt = getSavePerformanceNow();
      logSaveTiming(
        flowName,
        "time before supabase request starts",
        mutationStartedAt - saveStartedAt,
      );

      if (editingServiceId) {
        const response = await measureSaveStep(
          flowName,
          "supabase request duration",
          () =>
            supabase
              .from("services")
              .update({
                name: trimmedName,
                price: priceNumber,
                duration_minutes: durationNumber,
                color_hex: normalizeServiceColor(colorHex),
                rebooking_interval_value: intervalValue,
                rebooking_interval_unit:
                  intervalValue === null ? null : rebookingIntervalUnit,
              })
              .eq("id", editingServiceId)
              .eq("user_id", currentUserId)
              .select("id, name, price, duration_minutes, color_hex, rebooking_interval_value, rebooking_interval_unit")
              .single(),
        );

        error = response.error;
        savedService = isServiceRecord(response.data) ? response.data : null;
      } else {
        const response = await measureSaveStep(
          flowName,
          "supabase request duration",
          () =>
            supabase.from("services").insert({
              user_id: currentUserId,
              name: trimmedName,
              price: priceNumber,
              duration_minutes: durationNumber,
              color_hex: normalizeServiceColor(colorHex),
              rebooking_interval_value: intervalValue,
              rebooking_interval_unit:
                intervalValue === null ? null : rebookingIntervalUnit,
            })
            .select("id, name, price, duration_minutes, color_hex, rebooking_interval_value, rebooking_interval_unit")
            .single(),
        );

        error = response.error;
        savedService = isServiceRecord(response.data) ? response.data : null;
      }

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      postSupabaseStartedAt = getSavePerformanceNow();
      setSuccessMessage("Service saved.");

      const localStateRefreshStartedAt = getSavePerformanceNow();
      nameField.setValue("");
      priceField.setValue("");
      durationField.setValue("");
      setColorHex(DEFAULT_SERVICE_COLOR);
      rebookingIntervalValueField.setValue("");
      setRebookingIntervalUnit("weeks");
      setEditingServiceId(null);
      setServices((current) => {
        const nextService =
          savedService ||
          (editingServiceId
            ? ({
                id: editingServiceId,
                name: trimmedName,
                price: priceNumber,
                duration_minutes: durationNumber,
                color_hex: normalizeServiceColor(colorHex),
                rebooking_interval_value: intervalValue,
                rebooking_interval_unit:
                  intervalValue === null ? null : rebookingIntervalUnit,
              } satisfies ServiceRecord)
            : null);

        if (!nextService) {
          return current;
        }

        const filteredServices = current.filter(
          (service) => service.id !== nextService.id,
        );

        return [...filteredServices, nextService].sort((left, right) =>
          normalizeServiceName(left).localeCompare(normalizeServiceName(right)),
        );
      });
      if (isFirstService) {
        trackAnalyticsEvent("first_service_created");
      }
      logSaveTiming(
        flowName,
        "local state refresh",
        getSavePerformanceNow() - localStateRefreshStartedAt,
      );
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const completedAt = getSavePerformanceNow();

          if (postSupabaseStartedAt) {
            logSaveTiming(
              flowName,
              "post-supabase to local refresh completion",
              completedAt - postSupabaseStartedAt,
            );
          }

          logSaveTiming(
            flowName,
            "total time until continue",
            completedAt - saveStartedAt,
          );
        });
      });
    } catch (error) {
      console.log("Service save failed", error);
      const message = "Service could not be saved. Please try again.";
      setErrorMessage(message);
      Alert.alert("Error", message);
    } finally {
      setSaving(false);
    }

    return;
  }

  const fetchServices = useCallback(async () => {
    try {
      let currentUserId = userId || "";

      if (!currentUserId) {
        const { data: userData } = await supabase.auth.getUser();
        currentUserId = userData.user?.id || "";
      }

      if (!currentUserId) {
        setServices([]);
        return;
      }

      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("user_id", currentUserId)
        .order("name");
      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      setServices((data || []).filter(isServiceRecord));
    } catch (error) {
      console.log("Services load failed", error);
      setServices([]);
      Alert.alert("Error", "Services could not be loaded. Please try again.");
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      void fetchServices();
    }, [fetchServices]),
  );

  async function handleDeleteService(
    service: ServiceRecord | null | undefined,
  ) {
    if (!service?.id) {
      Alert.alert("Error", "No service ID found.");
      return;
    }

    try {
      let currentUserId = userId || "";

      if (!currentUserId) {
        const { data: userData } = await supabase.auth.getUser();
        currentUserId = userData.user?.id || "";
      }

      if (!currentUserId) {
        Alert.alert("Login Required", "Please log in first.");
        return;
      }

      await confirmDestructiveAction({
        title: "Delete Service",
        message: `Are you sure you want to delete "${normalizeServiceName(service)}"?`,
        confirmText: "Delete",
        onConfirm: async () => {
          const { error } = await supabase
            .from("services")
            .delete()
            .eq("id", service.id)
            .eq("user_id", currentUserId);

          if (error) {
            Alert.alert("Error", error.message);
            return;
          }

          setSuccessMessage("Service deleted.");
          setServices((current) =>
            current.filter((currentService) => currentService.id !== service.id),
          );
        },
      });
    } catch (error) {
      console.log("Service delete failed", error);
      Alert.alert("Error", "Service could not be deleted. Please try again.");
    }
  }

  function startEditingService(service: ServiceRecord | null | undefined) {
    if (!service?.id) {
      Alert.alert("Error", "No service ID found.");
      return;
    }

    setEditingServiceId(service.id);
    nameField.setValue(String(service.name || ""));
    priceField.setValue(String(service.price ?? ""));
    durationField.setValue(String(service.duration_minutes ?? ""));
    setColorHex(normalizeServiceColor(service.color_hex));
    rebookingIntervalValueField.setValue(
      service.rebooking_interval_value == null
        ? ""
        : String(service.rebooking_interval_value),
    );
    setRebookingIntervalUnit(service.rebooking_interval_unit || "weeks");
    setShowForm(true);
    setErrorMessage("");
    setSuccessMessage("");
    setTimeout(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      nameInputRef.current?.focus();
    }, 100);
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      ref={scrollRef}
      backgroundColor={colors.background}
      horizontalPadding={24}
      topPadding={24}
      bottomPadding={64}
    >
      <ScreenHeader
        title="Services"
        subtitle="Manage the services, prices, and timing you offer."
      />

      <ContextTip
        tipId="services_pricing_duration"
        userId={userId}
        visible={services.length > 0}
        message="Set the price and duration that Schedova uses when booking appointments."
      />

      {successMessage ? (
        <SuccessToast
          message={successMessage}
          onDismiss={() => setSuccessMessage("")}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {!canUseFeature("moreServices") ? (
        <AppCard
          variant="subtle"
          style={{
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 16,
          }}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "700" }}>
            Free plan: {services.length}/{FREE_TIER_LIMITS.services} services
          </Text>
        </AppCard>
      ) : null}

      {showForm ? (
        <AppCard
          style={{
            borderColor: polishedBorder,
            borderTopColor: colors.primary,
            borderTopWidth: 4,
            borderWidth: 1,
            marginBottom: 24,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
              marginBottom: 14,
            }}
          >
            <View
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: greenAccentSoft,
                borderWidth: 1,
                borderColor: colors.primary,
              }}
            >
              <Ionicons name="cut-outline" size={19} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  color: colors.text,
                  fontSize: 20,
                  fontWeight: "900",
                  marginBottom: 6,
                }}
              >
                {editingServiceId ? "Edit Service" : "Add Service"}
              </Text>
              <Text
                style={{
                  color: colors.mutedText,
                  lineHeight: 20,
                }}
              >
                {editingServiceId
                  ? "Update service details, pricing, and timing."
                  : "Set the name, price, and duration for a service."}
              </Text>
            </View>
          </View>

          <View
            style={{
              height: 1,
              backgroundColor: colors.border,
              marginBottom: 18,
            }}
          />

          {errorMessage ? (
            <View
              style={{
                borderWidth: 1,
                borderColor: destructiveBorder,
                backgroundColor: destructiveSoft,
                borderRadius: 14,
                padding: 12,
                marginBottom: 16,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontWeight: "800",
                  lineHeight: 20,
                }}
              >
                {errorMessage}
              </Text>
            </View>
          ) : null}

          <AppTextInput
            ref={nameInputRef}
            label="Service name"
            value={nameField.value}
            onChangeText={nameField.onChangeText}
            onEndEditing={nameField.onEndEditing}
            placeholder="Haircut"
          />

          <AppTextInput
            label="Price"
            value={priceField.value}
            onChangeText={priceField.onChangeText}
            onEndEditing={priceField.onEndEditing}
            keyboardType="numeric"
            placeholder="45"
          />

          <AppTextInput
            label="Duration minutes"
            value={durationField.value}
            onChangeText={durationField.onChangeText}
            onEndEditing={durationField.onEndEditing}
            keyboardType="numeric"
            placeholder="30"
          />

          <View
            style={{
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: 14,
              padding: 14,
              marginBottom: 18,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "900" }}>
              Rebooking reminder (optional)
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 4 }}>
              Schedova can identify clients who may be ready to book this service again. It never sends a text without your review.
            </Text>
            <AppTextInput
              label="Interval"
              value={rebookingIntervalValueField.value}
              onChangeText={rebookingIntervalValueField.onChangeText}
              onEndEditing={rebookingIntervalValueField.onEndEditing}
              keyboardType="number-pad"
              placeholder="6"
              containerStyle={{ marginTop: 12, marginBottom: 10 }}
            />
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {(["days", "weeks", "months"] as const).map((unit) => {
                const selected = rebookingIntervalUnit === unit;
                return (
                  <Pressable
                    key={unit}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Rebook every ${unit}`}
                    onPress={() => setRebookingIntervalUnit(unit)}
                    style={({ pressed }) => ({
                      minHeight: 44,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? greenAccentSoft : colors.background,
                      alignItems: "center",
                      justifyContent: "center",
                      paddingHorizontal: 14,
                      opacity: pressed ? 0.72 : 1,
                    })}
                  >
                    <Text style={{ color: selected ? colors.primary : colors.text, fontWeight: "800" }}>{unit}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Text
            style={{
              color: colors.text,
              fontWeight: "900",
              marginBottom: 12,
            }}
          >
            Service color
          </Text>

          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 22,
            }}
          >
            {serviceColors.map((color) => {
              const selected = normalizeServiceColor(colorHex) === color;

              return (
                <Pressable
                  key={color}
                  accessibilityRole="button"
                  accessibilityLabel={`Choose service color ${color}`}
                  onPress={() => setColorHex(color)}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: color,
                    borderWidth: selected ? 4 : 1,
                    borderColor: selected ? infoAccent : colors.border,
                  }}
                />
              );
            })}
          </View>

          <AppButton
            title={editingServiceId ? "Save Changes" : "Save Service"}
            loading={saving}
            disabled={saving}
            onPress={() => {
              void handleSave();
            }}
          />
        </AppCard>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 22,
            fontWeight: "900",
          }}
        >
          Existing Services
        </Text>
      </View>

      {services.length === 0 ? (
        <EmptyState
          title="No services yet"
          message="Create your first service."
          actionLabel="Add Service"
          onAction={() => {
            setShowForm(true);
            setTimeout(() => {
              scrollRef.current?.scrollTo({ y: 0, animated: true });
              nameInputRef.current?.focus();
            }, 100);
          }}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {services.map((service) => (
        <AppCard
          key={service.id}
          style={{
            borderColor: polishedBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 14,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 14,
                minHeight: 68,
                borderRadius: 999,
                backgroundColor: normalizeServiceColor(service.color_hex),
              }}
            />

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                numberOfLines={2}
                style={{
                  color: colors.text,
                  fontSize: 19,
                  fontWeight: "900",
                  lineHeight: 24,
                }}
              >
                {normalizeServiceName(service)}
              </Text>
              <Text
                style={{
                  color: infoAccent,
                  fontSize: 15,
                  fontWeight: "700",
                  lineHeight: 21,
                  marginTop: 5,
                }}
              >
                {formatServicePrice(service.price)} |{" "}
                {formatServiceDuration(service.duration_minutes)}
              </Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <AppButton
              title="Edit"
              variant="secondary"
              fullWidth={false}
              onPress={() => startEditingService(service)}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Delete"
              variant="destructive"
              fullWidth={false}
              onPress={() => {
                void handleDeleteService(service);
              }}
              style={{ flex: 1 }}
            />
          </View>
        </AppCard>
      ))}
    </AppScreen>
  );
}
