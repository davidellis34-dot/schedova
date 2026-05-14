import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function AddServiceScreen() {
  const [successMessage, setSuccessMessage] = useState("");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [colorHex, setColorHex] = useState("#0F766E");
  const router = useRouter();
  const { colors } = useAppTheme();
  const serviceColors = [
    "#0F766E",
    "#2563EB",
    "#7C3AED",
    "#DC2626",
    "#EA580C",
    "#DB2777",
    "#111827",
    "#CA8A04",
    "#92400E",
    "#0891B2",
  ];
  const [showForm, setShowForm] = useState(true);
  const scrollRef = useRef<ScrollView>(null);
  const nameInputRef = useRef<TextInput>(null);
  const [services, setServices] = useState<any[]>([]);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  async function handleSave() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      Alert.alert("Login Required", "Please log in first.");
      return;
    }

    if (!name || !price || !duration) {
      Alert.alert("Missing Info", "Please fill out all fields.");
      return;
    }

    let error;

    if (editingServiceId) {
      const response = await supabase
        .from("services")
        .update({
          name: name,
          price: Number(price),
          duration_minutes: Number(duration),
          color_hex: colorHex,
        })
        .eq("id", editingServiceId);

      error = response.error;
    } else {
      const response = await supabase.from("services").insert({
        user_id: userId,
        name: name,
        price: Number(price),
        duration_minutes: Number(duration),
        color_hex: colorHex,
      });

      error = response.error;
    }

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setSuccessMessage("Service saved.");

    setTimeout(() => {
      router.replace("/dashboard" as any);
    }, 300);

    return;
  }
  useEffect(() => {
    fetchServices();
  }, []);

  async function fetchServices() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setServices(data || []);
  }
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.background, padding: 24 }}
    >
      <Text
        style={{
          fontSize: 28,
          fontWeight: "bold",
          marginBottom: 24,
          color: colors.text,
        }}
      >
        Services
      </Text>

      {successMessage ? (
        <View
          style={{
            backgroundColor: colors.card,
            padding: 12,
            borderRadius: 12,
            marginBottom: 16,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontWeight: "bold",
              textAlign: "center",
            }}
          >
            {successMessage}
          </Text>
        </View>
      ) : null}

      {showForm && (
        <>
          <Text style={{ color: colors.text }}>Service Name</Text>
          <TextInput
            ref={nameInputRef}
            value={name}
            onChangeText={setName}
            placeholder="Haircut"
            placeholderTextColor="#888888"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
              color: colors.text,
            }}
          />

          <Text style={{ color: colors.text }}>Price</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            keyboardType="numeric"
            placeholder="45"
            placeholderTextColor="#888888"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 14,
              marginBottom: 16,
              color: colors.text,
            }}
          />

          <Text style={{ color: colors.text }}>Duration Minutes</Text>
          <TextInput
            value={duration}
            onChangeText={setDuration}
            keyboardType="numeric"
            placeholder="30"
            placeholderTextColor="#888888"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 10,
              padding: 14,
              marginBottom: 20,
              color: colors.text,
            }}
          />

          <Text
            style={{ color: colors.text, fontWeight: "bold", marginBottom: 12 }}
          >
            Pick Service Color
          </Text>

          <View
            style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 20 }}
          >
            {serviceColors.map((color) => (
              <Pressable
                key={color}
                onPress={() => setColorHex(color)}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  backgroundColor: color,
                  marginRight: 12,
                  marginBottom: 12,
                  borderWidth: colorHex === color ? 4 : 1,
                  borderColor: colors.border,
                }}
              />
            ))}
          </View>

          <Pressable
            onPress={handleSave}
            style={{
              backgroundColor: colors.card,
              padding: 16,
              borderRadius: 10,
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "bold" }}>
              {editingServiceId ? "Save Changes" : "Save Service"}
            </Text>
          </Pressable>
        </>
      )}

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 16,
          color: colors.text,
        }}
      >
        Existing Services
      </Text>

      {services.map((service) => (
        <View
          key={service.id}
          style={{
            backgroundColor: colors.card,
            padding: 16,
            borderRadius: 14,
            marginBottom: 12,
          }}
        >
          <Text
            style={{ fontSize: 18, fontWeight: "bold", color: colors.text }}
          >
            {service.name}
          </Text>
          <Text style={{ color: colors.text, marginTop: 4 }}>
            ${service.price} • {service.duration_minutes} mins
          </Text>

          <Pressable
            onPress={() => {
              setEditingServiceId(service.id);
              setName(service.name);
              setPrice(String(service.price));
              setDuration(String(service.duration_minutes));
              setColorHex(service.color_hex || "#0F766E");
              setShowForm(true);
              setTimeout(() => {
                scrollRef.current?.scrollTo({ y: 0, animated: true });
                nameInputRef.current?.focus();
              }, 100);
            }}
            style={{
              marginTop: 12,
              backgroundColor: "#0F766E",
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "bold" }}>Edit</Text>
          </Pressable>
          <Pressable
            onPress={() => {
              Alert.alert(
                "Delete Service",
                `Are you sure you want to delete "${service.name}"?`,
                [
                  { text: "Cancel", style: "cancel" },
                  {
                    text: "Delete",
                    style: "destructive",
                    onPress: async () => {
                      await supabase
                        .from("services")
                        .delete()
                        .eq("id", service.id);

                      fetchServices();
                    },
                  },
                ],
              );
            }}
            style={{
              marginTop: 8,
              backgroundColor: "#DC2626",
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "bold" }}>
              Delete
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
