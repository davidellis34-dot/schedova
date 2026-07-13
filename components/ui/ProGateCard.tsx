import { router } from "expo-router";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { ENABLE_PRO } from "../../lib/proFeatureFlag";
import { useAppTheme } from "../../lib/useAppTheme";
import { AppButton } from "./AppButton";
import { AppCard } from "./AppCard";
import { createSchedovaUiTheme } from "./theme";

type ProGateCardProps = {
  title?: string;
  message: string;
  features?: string[];
  ctaLabel?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function ProGateCard({
  title = "Schedova Pro",
  message,
  features,
  ctaLabel = "Upgrade to Schedova Pro",
  onPress,
  style,
}: ProGateCardProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, typography } = theme;

  if (!ENABLE_PRO) return null;

  function handlePress() {
    if (onPress) {
      onPress();
      return;
    }

    router.push("/schedova-pro" as never);
  }

  return (
    <AppCard style={style}>
      <Text
        style={{
          color: colors.text,
          fontSize: typography.sizes.section,
          fontWeight: typography.weights.heavy,
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: typography.sizes.bodyLarge,
          lineHeight: typography.lineHeights.subtitle,
          marginTop: spacing.sm,
        }}
      >
        {message}
      </Text>

      {features?.length ? (
        <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
          {features.map((feature) => (
            <View
              key={feature}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: spacing.sm,
              }}
            >
              <Text style={{ color: colors.primary, fontWeight: typography.weights.heavy }}>
                +
              </Text>
              <Text
                style={{
                  color: colors.text,
                  flex: 1,
                  lineHeight: typography.lineHeights.body,
                }}
              >
                {feature}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      <AppButton title={ctaLabel} onPress={handlePress} style={{ marginTop: spacing.lg }} />
    </AppCard>
  );
}
