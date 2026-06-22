import { Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme, getStatusTone } from "./theme";

type StatusBadgeProps = {
  status?: string | null;
  label?: string;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

export function StatusBadge({
  status,
  label,
  compact = false,
  style,
  textStyle,
}: StatusBadgeProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { spacing, radii, typography, borders } = theme;
  const tone = getStatusTone(status);

  return (
    <View
      style={[
        {
          alignSelf: "flex-start",
          backgroundColor: tone.background,
          borderWidth: borders.width,
          borderColor: tone.border,
          borderRadius: radii.pill,
          paddingHorizontal: compact ? spacing.sm : spacing.md,
          paddingVertical: compact ? 3 : spacing.xs,
        },
        style,
      ]}
    >
      <Text
        style={[
          {
            color: tone.text,
            fontSize: compact ? 11 : typography.sizes.caption,
            fontWeight: typography.weights.heavy,
          },
          textStyle,
        ]}
      >
        {label || tone.label}
      </Text>
    </View>
  );
}
