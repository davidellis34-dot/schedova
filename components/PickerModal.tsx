import type { ReactNode } from "react";
import {
  Modal,
  Pressable,
  type ModalProps,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type PickerModalAlign = "center" | "bottom";

type Props = {
  visible: boolean;
  onDismiss: () => void;
  children: ReactNode;
  align?: PickerModalAlign;
  animationType?: ModalProps["animationType"];
  backdropAccessibilityLabel?: string;
  centerMaxWidth?: number;
  horizontalPadding?: number;
  containerStyle?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
};

export function PickerModal({
  visible,
  onDismiss,
  children,
  align = "center",
  animationType = "fade",
  backdropAccessibilityLabel = "Close picker",
  centerMaxWidth = 420,
  horizontalPadding = 20,
  containerStyle,
  contentStyle,
}: Props) {
  const insets = useSafeAreaInsets();
  const centered = align === "center";

  return (
    <Modal
      visible={visible}
      transparent
      animationType={animationType}
      presentationStyle="overFullScreen"
      onRequestClose={onDismiss}
    >
      <View
        style={[
          {
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: centered ? "center" : "flex-end",
            paddingHorizontal: centered ? horizontalPadding : 0,
            paddingTop: centered ? insets.top + 20 : 0,
            paddingBottom: centered ? insets.bottom + 20 : 0,
          },
          containerStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={backdropAccessibilityLabel}
          onPress={onDismiss}
          style={{
            position: "absolute",
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
          }}
        />

        <View
          style={[
            centered
              ? {
                  width: "100%",
                  maxWidth: centerMaxWidth,
                  alignSelf: "center",
                }
              : null,
            contentStyle,
          ]}
        >
          {children}
        </View>
      </View>
    </Modal>
  );
}
