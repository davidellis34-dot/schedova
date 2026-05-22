import { Modal, Pressable, Text, TextInput, View } from "react-native";
import type { ThemeColors } from "./types";

function inputStyle(colors: ThemeColors) {
  return {
    backgroundColor: colors.card,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  };
}

export function QuickClientModal({
  visible,
  colors,
  name,
  phone,
  email,
  onChangeName,
  onChangePhone,
  onChangeEmail,
  onCancel,
  onSave,
}: {
  visible: boolean;
  colors: ThemeColors;
  name: string;
  phone: string;
  email: string;
  onChangeName: (value: string) => void;
  onChangePhone: (value: string) => void;
  onChangeEmail: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.45)",
          justifyContent: "center",
          padding: 22,
        }}
      >
        <View
          style={{
            backgroundColor: colors.background,
            borderRadius: 20,
            padding: 18,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 22,
              fontWeight: "900",
              marginBottom: 14,
            }}
          >
            New Client
          </Text>

          <TextInput
            placeholder="Name"
            placeholderTextColor={colors.mutedText}
            value={name}
            onChangeText={onChangeName}
            style={inputStyle(colors)}
          />
          <TextInput
            placeholder="Phone"
            placeholderTextColor={colors.mutedText}
            value={phone}
            onChangeText={onChangePhone}
            keyboardType="phone-pad"
            style={inputStyle(colors)}
          />
          <TextInput
            placeholder="Email"
            placeholderTextColor={colors.mutedText}
            value={email}
            onChangeText={onChangeEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={inputStyle(colors)}
          />

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={onCancel}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "800" }}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={onSave}
              style={{
                flex: 1,
                padding: 14,
                borderRadius: 12,
                backgroundColor: colors.primary,
                alignItems: "center",
              }}
            >
              <Text style={{ color: "white", fontWeight: "900" }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
