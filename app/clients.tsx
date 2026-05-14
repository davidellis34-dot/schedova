import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
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

    const { data } = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    setClients(data || []);
  }

  const filteredClients = clients.filter((client) => {
    const clientName = String(client.name || "").toLowerCase();
    const search = searchText.toLowerCase();

    return clientName.includes(search);
  });

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
        onPress={() => router.push("/add-client" as any)}
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
      <Text style={{ color: "red", marginBottom: 10 }}>
        Search: {searchText}
      </Text>
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
