import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { normalizeClientTag } from "../lib/clientTags";
import { canUseFeature, FREE_TIER_LIMITS } from "../lib/featureAccess";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
export default function ClientsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const [clients, setClients] = useState<any[]>([]);
  const [searchText, setSearchText] = useState("");

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setClients([]);
      return;
    }
    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    setClients(data || []);
  }

  const filteredClients = clients.filter((client) => {
    const search = searchText.toLowerCase();

    const clientName = String(client.name || "").toLowerCase();
    const clientPhone = String(client.phone || "").toLowerCase();
    const clientEmail = String(client.email || "").toLowerCase();

    return (
      clientName.includes(search) ||
      clientPhone.includes(search) ||
      clientEmail.includes(search)
    );
  });

  const canAddMoreClients =
    canUseFeature("moreClients") || clients.length < FREE_TIER_LIMITS.clients;

  function openAddClient() {
    if (!canAddMoreClients) {
      Alert.alert(
        "Schedova Pro",
        `Free includes up to ${FREE_TIER_LIMITS.clients} clients. Upgrade to add more.`,
      );
      return;
    }

    router.push("/add-client" as any);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background, padding: 20 }}
    >
      <Text
        style={{
          fontSize: 28,
          fontWeight: "bold",
          marginBottom: 20,
          color: colors.text,
        }}
      >
        Clients
      </Text>

      <Pressable
        onPress={openAddClient}
        style={{
          backgroundColor: colors.card,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "bold", fontSize: 16 }}>
          Add Client
        </Text>
      </Pressable>

      {!canUseFeature("moreClients") ? (
        <Text style={{ color: colors.mutedText, marginBottom: 14 }}>
          Free: {clients.length}/{FREE_TIER_LIMITS.clients} clients
        </Text>
      ) : null}

      <TextInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder="Search clients..."
        placeholderTextColor="#888888"
        style={{
          borderWidth: 2,
          borderColor: colors.border,
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
          color: colors.text,
          backgroundColor: colors.card,
          fontSize: 18,
        }}
      />
      {filteredClients.length === 0 && (
        <Text style={{ color: colors.text }}>No clients found.</Text>
      )}

      {filteredClients.map((client) => (
        <View
          key={client.id}
          style={{
            backgroundColor: colors.card,
            padding: 18,
            borderRadius: 16,
            marginBottom: 14,
          }}
        >
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/client-details",
                params: { clientId: client.id },
              })
            }
          >
            <Text
              style={{ fontSize: 20, fontWeight: "bold", color: colors.text }}
            >
              {client.name}
            </Text>

            <View
              style={{
                alignSelf: "flex-start",
                backgroundColor: colors.background,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                marginTop: 8,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "800" }}>
                {normalizeClientTag(client.client_tag)}
              </Text>
            </View>

            {!!client.phone && (
              <Text style={{ marginTop: 6, color: "#666666" }}>
                {client.phone}
              </Text>
            )}

            {!!client.email && (
              <Text style={{ marginTop: 2, color: "#666666" }}>
                {client.email}
              </Text>
            )}

            <Text
              style={{ marginTop: 10, color: "#0F766E", fontWeight: "bold" }}
            >
              View Client Profile →
            </Text>
          </Pressable>

          <Pressable
            onPress={() =>
              router.push({
                pathname: "/edit-client",
                params: { clientId: client.id },
              })
            }
            style={{
              backgroundColor: colors.card,
              padding: 12,
              borderRadius: 10,
              alignItems: "center",
              marginTop: 14,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "bold" }}>
              Edit Client
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
