import { Pressable, Text, View } from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { formatMoney, getTotalDuration, getTotalPrice } from "./bookingUtils";
import type { Service, ThemeColors } from "./types";

export function SelectedServicesList({
  services,
  colors,
  onRemove,
}: {
  services: Service[];
  colors: ThemeColors;
  onRemove: (index: number) => void;
}) {
  const totalDuration = getTotalDuration(services);
  const totalPrice = getTotalPrice(services);

  if (services.length === 0) {
    return (
      <Text style={{ color: colors.mutedText, marginBottom: 18 }}>
        No services selected yet.
      </Text>
    );
  }

  return (
    <View style={{ marginBottom: 18 }}>
      {services.map((service, index) => (
        <Swipeable
          key={`${service.id}-${index}`}
          renderRightActions={() => (
            <Pressable
              onPress={() => onRemove(index)}
              style={{
                backgroundColor: "#DC2626",
                justifyContent: "center",
                alignItems: "center",
                width: 86,
                borderRadius: 14,
                marginBottom: 10,
              }}
            >
              <Text style={{ color: "white", fontWeight: "800" }}>Delete</Text>
            </Pressable>
          )}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 12,
              marginBottom: 10,
            }}
          >
            <Text
              style={{ color: colors.text, fontWeight: "800", fontSize: 15 }}
            >
              {service.name || "Unnamed Service"}
            </Text>
            <Text style={{ color: colors.mutedText, marginTop: 4 }}>
              {Number(service.duration_minutes || 0)} min •{" "}
              {formatMoney(Number(service.price || 0))}
            </Text>
          </View>
        </Swipeable>
      ))}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          paddingTop: 10,
          marginTop: 2,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "800" }}>
          Total: {totalDuration} min • {formatMoney(totalPrice)}
        </Text>
      </View>
    </View>
  );
}
