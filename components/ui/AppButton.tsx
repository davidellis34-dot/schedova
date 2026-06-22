import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

export type AppButtonVariant = "primary" | "secondary" | "destructive" | "ghost";

type AppButtonProps = Omit<PressableProps, "style" | "children"> & {
  title?: string;
  children?: ReactNode;
  variant?: AppButtonVariant;
  loading?: boolean;
  fullWidth?: boolean;
  leftAccessory?: ReactNode;
  rightAccessory?: ReactNode;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function AppButton({
  title,
  children,
  variant = "primary",
  loading = false,
  disabled = false,
  fullWidth = true,
  leftAccessory,
  rightAccessory,
  style,
  textStyle,
  ...pressableProps
}: AppButtonProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, typography, borders } = theme;
  const isDisabled = disabled || loading;

  const variantStyles: Record<AppButtonVariant, ViewStyle> = {
    primary: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    secondary: {
      backgroundColor: colors.card,
      borderColor: colors.border,
    },
    destructive: {
      backgroundColor: colors.destructive,
      borderColor: colors.destructive,
    },
    ghost: {
      backgroundColor: "transparent",
      borderColor: "transparent",
    },
  };

  const labelColor =
    variant === "primary" || variant === "destructive"
      ? colors.white
      : variant === "ghost"
        ? colors.primary
        : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          minHeight: 52,
          width: fullWidth ? "100%" : undefined,
          borderRadius: radii.lg,
          borderWidth: variant === "ghost" ? 0 : borders.width,
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: spacing.sm,
          opacity: isDisabled ? 0.58 : pressed ? 0.84 : 1,
        },
        variantStyles[variant],
        style,
      ]}
      {...pressableProps}
    >
      {loading ? <ActivityIndicator color={labelColor} /> : leftAccessory}
      {children || title ? (
        <Text
          style={[
            {
              color: labelColor,
              fontSize: typography.sizes.bodyLarge,
              fontWeight: typography.weights.heavy,
              textAlign: "center",
            },
            textStyle,
          ]}
        >
          {children || title}
        </Text>
      ) : null}
      {!loading ? rightAccessory : null}
    </Pressable>
  );
}
