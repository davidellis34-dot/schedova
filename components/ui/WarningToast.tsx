import { Ionicons } from "@expo/vector-icons";
import {
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type WarningToastProps = {
  actionLabel?: string | null;
  message: string;
  onAction?: (() => void) | null;
  onDismiss?: (() => void) | null;
  style?: StyleProp<ViewStyle>;
  title?: string | null;
};

export function WarningToast({
  actionLabel,
  message,
  onAction,
  onDismiss,
  style,
  title,
}: WarningToastProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, borders, typography } = theme;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        {
          backgroundColor: `${colors.warning}14`,
          borderColor: `${colors.warning}55`,
          borderLeftColor: colors.warning,
          borderLeftWidth: 4,
          borderRadius: radii.lg,
          borderWidth: borders.width,
          gap: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        style,
      ]}
    >
      <View style={{ alignItems: "flex-start", flexDirection: "row", gap: spacing.sm }}>
        <Ionicons name="alert-circle" size={21} color={colors.warning} />
        <View style={{ flex: 1, gap: 4 }}>
          {title ? (
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.body,
                fontWeight: typography.weights.bold,
              }}
            >
              {title}
            </Text>
          ) : null}
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.helper,
              lineHeight: typography.lineHeights.helper,
            }}
          >
            {message}
          </Text>
        </View>
        {onDismiss ? (
          <Pressable
            accessibilityLabel="Dismiss warning"
            accessibilityRole="button"
            hitSlop={6}
            onPress={onDismiss}
            style={({ pressed }) => ({
              alignItems: "center",
              borderRadius: radii.md,
              height: 36,
              justifyContent: "center",
              opacity: pressed ? 0.68 : 1,
              width: 36,
            })}
          >
            <Ionicons name="close" size={20} color={colors.warning} />
          </Pressable>
        ) : null}
      </View>

      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            opacity: pressed ? 0.7 : 1,
            paddingVertical: 2,
          })}
        >
          <Text
            style={{
              color: colors.warning,
              fontSize: typography.sizes.helper,
              fontWeight: typography.weights.bold,
            }}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
