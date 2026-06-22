import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type ScreenHeaderProps = {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
  showBack?: boolean;
  onBackPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function ScreenHeader({
  title,
  subtitle,
  rightAction,
  showBack = false,
  onBackPress,
  style,
}: ScreenHeaderProps) {
  const router = useRouter();
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, typography } = theme;

  function handleBackPress() {
    if (onBackPress) {
      onBackPress();
      return;
    }

    router.back();
  }

  return (
    <View style={[{ marginBottom: spacing["2xl"] }, style]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: spacing.md,
        }}
      >
        <View style={{ flex: 1 }}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={handleBackPress}
              hitSlop={10}
              style={{
                alignSelf: "flex-start",
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                marginBottom: spacing.md,
              }}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primary} />
              <Text style={{ color: colors.primary, fontWeight: typography.weights.bold }}>
                Back
              </Text>
            </Pressable>
          ) : null}

          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.title,
              lineHeight: typography.lineHeights.title,
              fontWeight: typography.weights.heavy,
            }}
          >
            {title}
          </Text>

          {subtitle ? (
            <Text
              style={{
                color: colors.mutedText,
                fontSize: typography.sizes.bodyLarge,
                lineHeight: typography.lineHeights.subtitle,
                marginTop: spacing.sm,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>

        {rightAction ? <View style={{ paddingTop: spacing.xs }}>{rightAction}</View> : null}
      </View>
    </View>
  );
}
