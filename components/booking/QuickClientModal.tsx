import {
  KeyboardAvoidingView,
  Modal,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TextInputEndEditingEventData,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { normalizePhoneForSmsWithUserDefault } from "../../lib/countrySettings";
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
  onNameEndEditing,
  onChangePhone,
  onPhoneEndEditing,
  onChangeEmail,
  onEmailEndEditing,
  onCancel,
  onSave,
}: {
  visible: boolean;
  colors: ThemeColors;
  name: string;
  phone: string;
  email: string;
  onChangeName: (value: string) => void;
  onNameEndEditing?: (
    event: NativeSyntheticEvent<TextInputEndEditingEventData>,
  ) => void;
  onChangePhone: (value: string) => void;
  onPhoneEndEditing?: (
    event: NativeSyntheticEvent<TextInputEndEditingEventData>,
  ) => void;
  onChangeEmail: (value: string) => void;
  onEmailEndEditing?: (
    event: NativeSyntheticEvent<TextInputEndEditingEventData>,
  ) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            paddingHorizontal: 22,
            paddingTop: insets.top + 22,
            paddingBottom: insets.bottom + 22,
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
              onEndEditing={onNameEndEditing}
              style={inputStyle(colors)}
            />
            <TextInput
              placeholder="Phone"
              placeholderTextColor={colors.mutedText}
              value={phone}
              onChangeText={onChangePhone}
              onEndEditing={onPhoneEndEditing}
              onBlur={() => {
                if (!phone.trim()) {
                  onChangePhone("");
                  return;
                }

                void normalizePhoneForSmsWithUserDefault(phone.trim())
                  .then(onChangePhone)
                  .catch((error) => {
                    console.log("Phone normalization failed", error);
                  });
              }}
              keyboardType="phone-pad"
              style={inputStyle(colors)}
            />
            <TextInput
              placeholder="Email"
              placeholderTextColor={colors.mutedText}
              value={email}
              onChangeText={onChangeEmail}
              onEndEditing={onEmailEndEditing}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
