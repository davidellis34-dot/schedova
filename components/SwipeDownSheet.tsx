import { ReactNode, useRef } from "react";
import { Modal, PanResponder, Pressable, View } from "react-native";

export default function SwipeDownSheet({
  visible,
  onClose,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 20,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 80) {
          onClose();
        }
      },
    }),
  ).current;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.4)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable
          onPress={() => {}}
          {...responder.panHandlers}
          style={{
            backgroundColor: "#ffffff",
            padding: 24,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: "88%",
          }}
        >
          <View
            style={{
              width: 50,
              height: 5,
              borderRadius: 999,
              backgroundColor: "#D1D5DB",
              alignSelf: "center",
              marginBottom: 14,
            }}
          />

          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
