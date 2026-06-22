import type { ReactNode } from "react";
import {
  Pressable,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type AppCardVariant = "default" | "subtle" | "outlined";

type AppCardProps = Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  onPress?: () => void;
  variant?: AppCardVariant;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function AppCard({
  children,
  onPress,
  variant = "default",
  style,
  contentStyle,
  ...pressableProps
}: AppCardProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, borders } = theme;

  const baseStyle: ViewStyle = {
    backgroundColor: variant === "subtle" ? colors.background : colors.card,
    borderWidth: variant === "default" || variant === "outlined" ? borders.width : 0,
    borderColor: colors.border,
    borderRadius: radii.xl,
    padding: spacing.lg,
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          baseStyle,
          pressed ? { opacity: 0.82 } : null,
          style,
          contentStyle,
        ]}
        {...pressableProps}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={[baseStyle, style, contentStyle]}>{children}</View>;
}
