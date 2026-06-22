import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  EmptyState,
  ScreenHeader,
} from "../components/ui";
import { normalizeClientTag } from "../lib/clientTags";
import {
  canUseFeature,
  FREE_TIER_LIMITS,
  useFeatureAccess,
} from "../lib/featureAccess";
import { useAuthSession } from "../lib/authSession";
import { PRO_UPSELL_COPY, showProUpgradePrompt } from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

export default function ClientsScreen() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const { isHydrated, userId } = useAuthSession();
  useFeatureAccess();
  const [clients, setClients] = useState<any[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [searchText, setSearchText] = useState("");
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentSoft = isDarkTheme
    ? "rgba(96, 165, 250, 0.16)"
    : "rgba(37, 99, 235, 0.10)";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const greenAccentSoft = isDarkTheme
    ? "rgba(15, 118, 110, 0.28)"
    : "rgba(15, 118, 110, 0.12)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  useFocusEffect(
    useCallback(() => {
      let isActive = true;

      async function fetchClients() {
        if (!isActive) return;

        if (!isHydrated) {
          setLoadingClients(true);
          return;
        }

        setLoadingClients(true);

        if (!userId) {
          setClients([]);
          setLoadingClients(false);
          router.replace("/login" as any);
          return;
        }

        const { data, error } = await supabase
          .from("clients")
          .select("*")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("name");

        if (!isActive) return;

        if (error) {
          Alert.alert("Error", error.message);
          setLoadingClients(false);
          return;
        }

        setClients((data || []).filter(Boolean));
        setLoadingClients(false);
      }

      void fetchClients();

      return () => {
        isActive = false;
      };
    }, [isHydrated, router, userId]),
  );

  const filteredClients = clients.filter((client) => {
    if (!client?.id) return false;

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

  async function openAddClient() {
    if (!canAddMoreClients) {
      showProUpgradePrompt(PRO_UPSELL_COPY.freeLimit);
      return;
    }

    router.push("/add-client" as any);
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={64}>
      <ScreenHeader
        title="Clients"
        subtitle="Keep client details and appointment history organized."
      />

      <AppButton
        title="Add Client"
        onPress={() => {
          void openAddClient();
        }}
        style={{ marginBottom: 14 }}
      />

      {!canUseFeature("moreClients") ? (
        <AppCard
          variant="subtle"
          style={{
            borderColor: infoAccentBorder,
            borderLeftColor: infoAccent,
            borderLeftWidth: 4,
            borderWidth: 1,
            marginBottom: 14,
          }}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "700" }}>
            Free plan: {loadingClients ? "..." : clients.length}/
            {FREE_TIER_LIMITS.clients} clients
          </Text>
        </AppCard>
      ) : null}

      <AppTextInput
        value={searchText}
        onChangeText={setSearchText}
        placeholder="Search clients"
        autoCapitalize="none"
        containerStyle={{ marginBottom: 20 }}
      />

      {loadingClients ? (
        <View
          style={{
            alignItems: "center",
            paddingVertical: 28,
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedText, marginTop: 10 }}>
            Loading clients...
          </Text>
        </View>
      ) : filteredClients.length === 0 ? (
        <EmptyState
          title={clients.length === 0 ? "No clients yet" : "No clients found"}
          message={
            clients.length === 0
              ? "Add your first client to start booking appointments faster."
              : "Try a different name, phone, or email."
          }
          actionLabel={clients.length === 0 ? "Add Client" : undefined}
          onAction={
            clients.length === 0
              ? () => {
                  void openAddClient();
                }
              : undefined
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      {filteredClients.map((client) => {
        const tag = normalizeClientTag(client.client_tag);

        return (
          <AppCard
            key={client.id}
            style={{
              borderColor: polishedBorder,
              borderLeftColor: infoAccent,
              borderLeftWidth: 4,
              borderWidth: 1,
              marginBottom: 14,
            }}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/client-details",
                  params: { clientId: client.id },
                })
              }
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 42,
                    height: 42,
                    borderRadius: 21,
                    backgroundColor: greenAccentSoft,
                    borderColor: `${colors.primary}55`,
                    borderWidth: 1,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      color: colors.primary,
                      fontSize: 17,
                      fontWeight: "900",
                    }}
                  >
                    {String(client.name || "?")
                      .trim()
                      .slice(0, 1)
                      .toUpperCase() || "?"}
                  </Text>
                </View>

                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 20,
                      fontWeight: "900",
                    }}
                  >
                    {client.name || "Unnamed Client"}
                  </Text>

                  {!!client.phone && (
                    <Text
                      style={{
                        color: colors.mutedText,
                        fontWeight: "600",
                        marginTop: 8,
                      }}
                    >
                      {client.phone}
                    </Text>
                  )}

                  {!!client.email && (
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="tail"
                      style={{
                        color: colors.mutedText,
                        marginTop: 3,
                        maxWidth: "100%",
                      }}
                    >
                      {client.email}
                    </Text>
                  )}
                </View>

                <View
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: infoAccentSoft,
                    borderWidth: 1,
                    borderColor: infoAccentBorder,
                    borderRadius: 999,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ color: infoAccent, fontWeight: "900" }}>
                    {tag}
                  </Text>
                </View>
              </View>

              <Text
                style={{
                  color: infoAccent,
                  fontWeight: "900",
                  marginTop: 14,
                }}
              >
                View Client Profile
              </Text>
            </Pressable>

            <AppButton
              title="Edit Client"
              onPress={() =>
                router.push({
                  pathname: "/edit-client",
                  params: { clientId: client.id },
                })
              }
              style={{ marginTop: 14 }}
            />
          </AppCard>
        );
      })}
    </AppScreen>
  );
}
