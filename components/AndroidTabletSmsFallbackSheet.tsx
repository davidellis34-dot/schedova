import { Modal, Pressable, Text, View } from "react-native";

import { useAppTheme } from "../lib/useAppTheme";
import { AppButton } from "./ui/AppButton";
import { createSchedovaUiTheme } from "./ui/theme";

export type AndroidTabletSmsFallback = {
  rawPhone: string;
  messageBody: string;
  fallbackText: string;
};

type AndroidTabletSmsFallbackSheetProps = {
  visible: boolean;
  onCancel: () => void;
  onCopy: () => void;
  onOpenMessages: () => void;
  onShare: () => void;
};

export function AndroidTabletSmsFallbackSheet({
  visible,
  onCancel,
  onCopy,
  onOpenMessages,
  onShare,
}: AndroidTabletSmsFallbackSheetProps) {
  const { colors: appColors } = useAppTheme();
  const theme = createSchedovaUiTheme(appColors);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Cancel SMS fallback"
        onPress={onCancel}
        style={{
          flex: 1,
          backgroundColor: "rgba(0, 0, 0, 0.58)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={{
            backgroundColor: theme.colors.background,
            borderTopLeftRadius: theme.radii["2xl"],
            borderTopRightRadius: theme.radii["2xl"],
            borderWidth: 1,
            borderColor: theme.colors.border,
            padding: theme.spacing.lg,
            gap: theme.spacing.sm,
          }}
        >
          <View style={{ marginBottom: theme.spacing.xs }}>
            <Text
              style={{
                color: theme.colors.text,
                fontSize: theme.typography.sizes.section,
                fontWeight: theme.typography.weights.heavy,
              }}
            >
              Android tablet messages
            </Text>
            <Text
              style={{
                color: theme.colors.mutedText,
                lineHeight: theme.typography.lineHeights.body,
                marginTop: theme.spacing.xs,
              }}
            >
              Android tablets may open Messages without the recipient or message.
            </Text>
          </View>

          <AppButton title="Copy message" onPress={onCopy} />
          <AppButton title="Share message" variant="secondary" onPress={onShare} />
          <AppButton
            title="Open Messages anyway"
            variant="secondary"
            onPress={onOpenMessages}
          />
          <AppButton title="Cancel" variant="ghost" onPress={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
