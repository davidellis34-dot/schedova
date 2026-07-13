import type { ReactNode } from "react";
import {
  Pressable,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type ListRowProps = Omit<PressableProps, "style" | "children"> & {
  title: string;
  subtitle?: string;
  helper?: string;
  leftIcon?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ListRow({
  title,
  subtitle,
  helper,
  leftIcon,
  right,
  onPress,
  destructive = false,
  style,
  ...pressableProps
}: ListRowProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, typography, borders } = theme;
  const content = (
    <>
      {leftIcon ? <View style={{ marginRight: spacing.md }}>{leftIcon}</View> : null}

      <View style={{ flex: 1 }}>
        <Text
          style={{
            color: destructive ? colors.destructive : colors.text,
            fontSize: typography.sizes.bodyLarge,
            fontWeight: typography.weights.bold,
          }}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text
            style={{
              color: colors.mutedText,
              fontSize: typography.sizes.helper,
              lineHeight: typography.lineHeights.helper,
              marginTop: spacing.xs,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
        {helper ? (
          <Text
            style={{
              color: colors.mutedText,
              fontSize: typography.sizes.caption,
              marginTop: spacing.xs,
            }}
          >
            {helper}
          </Text>
        ) : null}
      </View>

      {right ? <View style={{ marginLeft: spacing.md }}>{right}</View> : null}
    </>
  );

  const rowStyle: ViewStyle = {
    minHeight: 58,
    backgroundColor: colors.card,
    borderWidth: borders.width,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
  };

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [rowStyle, pressed ? { opacity: 0.82 } : null, style]}
        {...pressableProps}
      >
        {content}
      </Pressable>
    );
  }

  return <View style={[rowStyle, style]}>{content}</View>;
}
