import { ReactNode } from "react";
import { Text, View } from "react-native";
import type { ThemeColors } from "./types";

export function PickerBox({
  label,
  children,
  colors,
}: {
  label: string;
  children: ReactNode;
  colors: ThemeColors;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text
        style={{
          color: colors.text,
          fontWeight: "700",
          marginBottom: 8,
        }}
      >
        {label}
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          backgroundColor: colors.card,
          overflow: "hidden",
          minHeight: 56,
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  );
}
