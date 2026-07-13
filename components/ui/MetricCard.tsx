import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type MetricCardProps = {
  label: string;
  value: string | number;
  helper?: string;
  trend?: string;
  style?: StyleProp<ViewStyle>;
};

export function MetricCard({ label, value, helper, trend, style }: MetricCardProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, typography, borders } = theme;

  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 150,
          backgroundColor: colors.card,
          borderWidth: borders.width,
          borderColor: colors.border,
          borderRadius: radii.xl,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: colors.mutedText,
          fontSize: typography.sizes.caption,
          fontWeight: typography.weights.bold,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: colors.text,
          fontSize: typography.sizes.metric,
          fontWeight: typography.weights.heavy,
          marginTop: spacing.sm,
        }}
      >
        {value}
      </Text>
      {helper || trend ? (
        <Text
          style={{
            color: trend ? colors.primary : colors.mutedText,
            fontSize: typography.sizes.caption,
            lineHeight: 17,
            marginTop: spacing.sm,
            fontWeight: trend ? typography.weights.bold : typography.weights.regular,
          }}
        >
          {trend || helper}
        </Text>
      ) : null}
    </View>
  );
}
