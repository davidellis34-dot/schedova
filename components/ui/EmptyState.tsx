import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useAppTheme } from "../../lib/useAppTheme";
import { AppButton } from "./AppButton";
import { createSchedovaUiTheme } from "./theme";

type EmptyStateProps = {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
  style,
}: EmptyStateProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, typography, borders } = theme;

  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderWidth: borders.width,
          borderColor: colors.border,
          borderRadius: radii.xl,
          padding: spacing.xl,
          alignItems: "center",
        },
        style,
      ]}
    >
      <Text
        style={{
          color: colors.text,
          fontSize: typography.sizes.cardTitle,
          fontWeight: typography.weights.heavy,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.mutedText,
          fontSize: typography.sizes.body,
          lineHeight: typography.lineHeights.body,
          textAlign: "center",
          marginTop: spacing.sm,
        }}
      >
        {message}
      </Text>

      {actionLabel && onAction ? (
        <AppButton
          title={actionLabel}
          onPress={onAction}
          style={{ marginTop: spacing.lg }}
        />
      ) : null}
    </View>
  );
}
