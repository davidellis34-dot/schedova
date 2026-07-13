import { ReactNode } from "react";
import { Text, View } from "react-native";
import type { ThemeColors } from "./types";

export function PickerBox({
  label,
  children,
  colors,
  accentColor,
  backgroundColor,
}: {
  label: string;
  children: ReactNode;
  colors: ThemeColors;
  accentColor?: string;
  backgroundColor?: string;
}) {
  return (
    <View style={{ marginBottom: 18 }}>
      <Text
        style={{
          color: colors.text,
          fontWeight: "800",
          marginBottom: 8,
        }}
      >
        {label}
      </Text>

      <View
        style={{
          borderWidth: 1,
          borderColor: accentColor || colors.border,
          borderRadius: 14,
          backgroundColor: backgroundColor || colors.card,
          overflow: "hidden",
          minHeight: 56,
          width: "100%",
          justifyContent: "center",
        }}
      >
        {children}
      </View>
    </View>
  );
}
