import { Pressable, Text, View } from "react-native";
import { formatMoney, getTotalDuration, getTotalPrice } from "./bookingUtils";
import type { Service, ThemeColors } from "./types";

function isRenderableService(service: unknown): service is Service {
  return !!service && typeof service === "object";
}

function getServiceAccent(service: Service) {
  const color = String(service.color_hex || "").trim();
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(color)
    ? color
    : "#2563EB";
}

function getDurationLabel(value: unknown) {
  const duration = Number(value);
  return Number.isFinite(duration) && duration > 0
    ? `${Math.round(duration)} min`
    : "Duration not set";
}

function getPriceLabel(value: unknown) {
  const price = Number(value);
  return Number.isFinite(price) && price >= 0
    ? formatMoney(price)
    : "Price not set";
}

export function SelectedServicesList({
  services,
  colors,
  onRemove,
}: {
  services: Service[];
  colors: ThemeColors;
  onRemove: (index: number) => void;
}) {
  const serviceRows = Array.isArray(services)
    ? services
        .map((service, originalIndex) => ({ service, originalIndex }))
        .filter((row) => isRenderableService(row.service))
    : [];
  const safeServices = serviceRows.map((row) => row.service);
  const totalDuration = getTotalDuration(safeServices);
  const totalPrice = getTotalPrice(safeServices);

  if (serviceRows.length === 0) {
    return (
      <Text style={{ color: colors.mutedText, marginBottom: 18 }}>
        No services selected yet.
      </Text>
    );
  }

  return (
    <View style={{ marginBottom: 18 }}>
      {serviceRows.map(({ service, originalIndex }) => {
        const serviceAccent = getServiceAccent(service);

        return (
          <View
            key={`${String(service.id || "service")}-${originalIndex}`}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderLeftWidth: 4,
              borderLeftColor: serviceAccent,
              borderRadius: 14,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={{ flex: 1 }}>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}
                >
                  {String(service.name || "").trim() || "Unnamed Service"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ color: colors.mutedText, marginTop: 4 }}
                >
                  {getDurationLabel(service.duration_minutes)} -{" "}
                  {getPriceLabel(service.price)}
                </Text>
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove selected service"
                onPress={() => onRemove(originalIndex)}
                style={{
                  backgroundColor: "#DC2626",
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 999,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontWeight: "800" }}>
                  Remove
                </Text>
              </Pressable>
            </View>
          </View>
        );
      })}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: 10,
          marginTop: 2,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "800" }}>
          Service estimate: {totalDuration} min - {formatMoney(totalPrice)}
        </Text>
      </View>
    </View>
  );
}
