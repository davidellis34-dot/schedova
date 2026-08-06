import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type LoadingCardProps = {
  label: string;
  lines?: number;
  style?: StyleProp<ViewStyle>;
};

export function LoadingCard({ label, lines = 2, style }: LoadingCardProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, borders, typography } = theme;
  const placeholderColor = `${colors.mutedText}22`;

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={[
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: borders.width,
          borderRadius: radii.xl,
          padding: spacing.lg,
        },
        style,
      ]}
    >
      <View
        style={{
          width: "42%",
          height: 14,
          borderRadius: radii.pill,
          backgroundColor: placeholderColor,
          marginBottom: spacing.md,
        }}
      />
      {Array.from({ length: lines }).map((_, index) => (
        <View
          key={index}
          style={{
            width: index === lines - 1 ? "68%" : "100%",
            height: 11,
            borderRadius: radii.pill,
            backgroundColor: placeholderColor,
            marginBottom: index === lines - 1 ? spacing.md : spacing.sm,
          }}
        />
      ))}
      <Text
        style={{
          color: colors.mutedText,
          fontSize: typography.sizes.helper,
          fontWeight: typography.weights.medium,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
