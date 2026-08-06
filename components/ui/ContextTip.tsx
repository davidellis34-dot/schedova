import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";
import {
  dismissContextTip,
  isContextTipDismissed,
  type ContextTipId,
} from "../../lib/contextTips";
import { useAppTheme } from "../../lib/useAppTheme";
import { createSchedovaUiTheme } from "./theme";

type ContextTipProps = {
  tipId: ContextTipId;
  userId: string | null | undefined;
  message: string;
  visible?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function ContextTip({
  tipId,
  userId,
  message,
  visible = true,
  style,
}: ContextTipProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);
  const { colors, spacing, radii, borders, typography } = theme;
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    let active = true;

    if (!visible || !userId) {
      setIsVisible(false);
      return () => {
        active = false;
      };
    }

    void isContextTipDismissed(userId, tipId)
      .then((dismissed) => {
        if (active) {
          setIsVisible(!dismissed);
        }
      })
      .catch(() => {
        // Local storage trouble should not prevent a helpful first-run tip.
        if (active) {
          setIsVisible(true);
        }
      });

    return () => {
      active = false;
    };
  }, [tipId, userId, visible]);

  const handleDismiss = () => {
    if (!userId) return;

    setIsVisible(false);
    void dismissContextTip(userId, tipId).catch(() => {
      // The UI remains dismissed for this session if local storage is unavailable.
    });
  };

  if (!isVisible) return null;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.sm,
          backgroundColor: `${colors.info}14`,
          borderColor: `${colors.info}55`,
          borderWidth: borders.width,
          borderRadius: radii.lg,
          paddingLeft: spacing.md,
          paddingRight: spacing.xs,
          paddingVertical: spacing.sm,
          marginBottom: spacing.lg,
        },
        style,
      ]}
    >
      <Ionicons name="bulb-outline" size={20} color={colors.info} />
      <Text
        style={{
          flex: 1,
          color: colors.text,
          fontSize: typography.sizes.helper,
          fontWeight: typography.weights.semibold,
          lineHeight: typography.lineHeights.helper,
        }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss tip"
        hitSlop={6}
        onPress={handleDismiss}
        style={({ pressed }) => ({
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: radii.md,
          opacity: pressed ? 0.68 : 1,
        })}
      >
        <Text
          style={{
            color: colors.info,
            fontSize: typography.sizes.caption,
            fontWeight: typography.weights.heavy,
          }}
        >
          Got it
        </Text>
      </Pressable>
    </View>
  );
}
