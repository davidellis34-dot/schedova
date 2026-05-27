import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { supabase } from "../../lib/supabase";
import type { Service, ThemeColors } from "./types";

type Props = {
  visible: boolean;
  colors: ThemeColors;
  userId: string;
  name: string;
  price: string;
  duration: string;
  onChangeName: (value: string) => void;
  onChangePrice: (value: string) => void;
  onChangeDuration: (value: string) => void;
  onCancel: () => void;
  onSaved: (service: Service) => void;
};

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

export function QuickServiceModal({
  visible,
  colors,
  userId,
  name,
  price,
  duration,
  onChangeName,
  onChangePrice,
  onChangeDuration,
  onCancel,
  onSaved,
}: Props) {
  const insets = useSafeAreaInsets();

  async function saveQuickService() {
    if (!userId) {
      Alert.alert("Login Required", "Please sign in to add a service.");
      return;
    }

    const priceNumber = Number.isFinite(Number(price)) ? Number(price) : 0;

    const durationNumber = Number.isFinite(Number(duration))
      ? Number(duration)
      : 30;

    if (priceNumber < 0) {
      Alert.alert("Invalid Price", "Price must be zero or higher.");
      return;
    }

    if (durationNumber <= 0) {
      Alert.alert("Invalid Duration", "Duration must be greater than zero.");
      return;
    }

    const { data, error } = await supabase
      .from("services")
      .insert({
        user_id: userId,
        name: name.trim() || "New Service",
        price: priceNumber,
        duration_minutes: durationNumber,
        color_hex: "#2563EB",
      })
      .select("*")
      .single();

    if (error || !data) {
      console.log("QUICK SERVICE ERROR:", error);
      Alert.alert("Error", error?.message || "Could not add service.");
      return;
    }

    onSaved({
      ...data,
      id: String(data.id || ""),
    });
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
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
            justifyContent: "center",
            paddingHorizontal: 20,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
            backgroundColor: "rgba(0,0,0,0.35)",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderRadius: 18,
              padding: 20,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 22,
                fontWeight: "bold",
                marginBottom: 16,
              }}
            >
              Quick Add Service
            </Text>

            <TextInput
              value={name}
              onChangeText={onChangeName}
              placeholder="Service name"
              placeholderTextColor={colors.mutedText}
              style={inputStyle(colors)}
            />

            <TextInput
              value={price}
              onChangeText={onChangePrice}
              placeholder="Price"
              placeholderTextColor={colors.mutedText}
              keyboardType="numeric"
              style={inputStyle(colors)}
            />

            <TextInput
              value={duration}
              onChangeText={onChangeDuration}
              placeholder="Duration minutes"
              placeholderTextColor={colors.mutedText}
              keyboardType="numeric"
              style={inputStyle(colors)}
            />

            <Pressable
              onPress={saveQuickService}
              style={{
                backgroundColor: colors.primary,
                padding: 14,
                borderRadius: 12,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
                Save Service
              </Text>
            </Pressable>

            <Pressable
              onPress={onCancel}
              style={{
                backgroundColor: colors.card,
                padding: 14,
                borderRadius: 12,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "bold" }}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
