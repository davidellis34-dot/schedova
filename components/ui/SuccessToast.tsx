import { Ionicons } from "@expo/vector-icons";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type SuccessToastProps = {
  message: string;
  onDismiss?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SuccessToast({ message, onDismiss, style }: SuccessToastProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, borders, typography } = theme;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          backgroundColor: `${colors.success}16`,
          borderColor: `${colors.success}66`,
          borderWidth: borders.width,
          borderRadius: radii.lg,
          borderLeftColor: colors.success,
          borderLeftWidth: 4,
          paddingLeft: spacing.md,
          paddingRight: onDismiss ? spacing.xs : spacing.md,
          paddingVertical: spacing.sm,
        },
        style,
      ]}
    >
      <Ionicons name="checkmark-circle" size={21} color={colors.success} />
      <Text
        style={{
          flex: 1,
          color: colors.text,
          fontSize: typography.sizes.helper,
          fontWeight: typography.weights.bold,
          lineHeight: typography.lineHeights.helper,
        }}
      >
        {message}
      </Text>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss success message"
          hitSlop={6}
          onPress={onDismiss}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: radii.md,
            opacity: pressed ? 0.68 : 1,
          })}
        >
          <Ionicons name="close" size={20} color={colors.success} />
        </Pressable>
      ) : null}
    </View>
  );
}
