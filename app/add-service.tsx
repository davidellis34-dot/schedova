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
  EmptyState,
  ScreenHeader,
} from "../components/ui";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import {
  canUseFeature,
  FREE_TIER_LIMITS,
  useFeatureAccess,
} from "../lib/featureAccess";
import { PRO_UPSELL_COPY, showProUpgradePrompt } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type ServiceRecord = {
  id: string;
  name?: string | null;
  price?: number | string | null;
  duration_minutes?: number | string | null;
  color_hex?: string | null;
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
  useFeatureAccess();
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [colorHex, setColorHex] = useState(DEFAULT_SERVICE_COLOR);
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

  useFocusEffect(
    useCallback(() => {
      void fetchServices();
    }, []),
  );

  async function handleSave() {
    if (saving) return;

    setSaving(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        const message = "Please log in first.";
        setErrorMessage(message);
        Alert.alert("Login Required", message);
        return;
      }

      const trimmedName = name.trim();

      if (!trimmedName || !price || !duration) {
        const message = "Please fill out all fields.";
        setErrorMessage(message);
        Alert.alert("Missing Info", message);
        return;
      }

      const priceNumber = Number(price);
      const durationNumber = Number(duration);

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
        !editingServiceId &&
        !canUseFeature("moreServices") &&
        services.length >= FREE_TIER_LIMITS.services
      ) {
        showProUpgradePrompt(PRO_UPSELL_COPY.freeLimit);
        return;
      }

      let error;

      if (editingServiceId) {
        const response = await supabase
          .from("services")
          .update({
            name: trimmedName,
            price: priceNumber,
            duration_minutes: durationNumber,
            color_hex: normalizeServiceColor(colorHex),
          })
          .eq("id", editingServiceId)
          .eq("user_id", userId);

        error = response.error;
      } else {
        const response = await supabase.from("services").insert({
          user_id: userId,
          name: trimmedName,
          price: priceNumber,
          duration_minutes: durationNumber,
          color_hex: normalizeServiceColor(colorHex),
        });

        error = response.error;
      }

      if (error) {
        setErrorMessage(error.message);
        Alert.alert("Error", error.message);
        return;
      }

      setSuccessMessage("Service saved.");

      setName("");
      setPrice("");
      setDuration("");
      setColorHex(DEFAULT_SERVICE_COLOR);
      setEditingServiceId(null);
      await fetchServices();
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

  async function fetchServices() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        setServices([]);
        return;
      }

      const { data, error } = await supabase
        .from("services")
        .select("*")
        .eq("user_id", userId)
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
  }

  async function handleDeleteService(
    service: ServiceRecord | null | undefined,
  ) {
    if (!service?.id) {
      Alert.alert("Error", "No service ID found.");
      return;
    }

    try {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

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
          await fetchServices();
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
    setName(String(service.name || ""));
    setPrice(String(service.price ?? ""));
    setDuration(String(service.duration_minutes ?? ""));
    setColorHex(normalizeServiceColor(service.color_hex));
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

      {successMessage ? (
        <AppCard
          style={{
            borderColor: infoAccentBorder,
            borderLeftColor: colors.primary,
            borderLeftWidth: 4,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontWeight: "900",
              textAlign: "center",
            }}
          >
            {successMessage}
          </Text>
        </AppCard>
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
            value={name}
            onChangeText={setName}
            placeholder="Haircut"
          />

          <AppTextInput
            label="Price"
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            placeholder="45"
          />

          <AppTextInput
            label="Duration minutes"
            value={duration}
            onChangeText={setDuration}
            keyboardType="numeric"
            placeholder="30"
          />

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
          message="Add your first service so appointments can include pricing and timing."
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
