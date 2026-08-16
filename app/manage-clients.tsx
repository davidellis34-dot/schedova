import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Alert, Text, View } from "react-native";

import { AppCard, AppScreen, ListRow, LoadingCard, ScreenHeader } from "../components/ui";
import { shareActiveClientsCsv, shareClientCsvTemplate } from "../lib/clientDataActions";
import { useAuthSession } from "../lib/authSession";
import { useAppTheme } from "../lib/useAppTheme";

export default function ManageClientsScreen() {
  const router = useRouter();
  const { userId } = useAuthSession();
  const { colors } = useAppTheme();
  const [busyAction, setBusyAction] = useState<"export" | "template" | null>(null);

  async function handleExport() {
    if (!userId || busyAction) return;

    setBusyAction("export");
    try {
      const count = await shareActiveClientsCsv(userId);
      Alert.alert(
        "CSV ready",
        `${count} active client${count === 1 ? "" : "s"} prepared for export.`,
      );
    } catch (error) {
      Alert.alert(
        "Export failed",
        error instanceof Error ? error.message : "Client CSV export could not be prepared.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  async function handleTemplateDownload() {
    if (busyAction) return;

    setBusyAction("template");
    try {
      await shareClientCsvTemplate();
    } catch (error) {
      Alert.alert(
        "Template download failed",
        error instanceof Error ? error.message : "Client CSV template could not be prepared.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <AppScreen scroll backgroundColor={colors.background} bottomPadding={64}>
      <ScreenHeader
        title="Manage clients"
        subtitle="Import a CSV, export your active client list, or clean up duplicates."
        showBack
      />

      <AppCard style={{ marginBottom: 16 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: `${colors.primary}16`,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="folder-open-outline" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 6,
              }}
            >
              Client data tools
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              Imports never turn on SMS or email consent automatically, and exports
              always include only active clients from this account.
            </Text>
          </View>
        </View>
      </AppCard>

      {busyAction ? (
        <LoadingCard
          label={
            busyAction === "export"
              ? "Preparing client export..."
              : "Preparing CSV template..."
          }
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <View style={{ gap: 12 }}>
        <ListRow
          title="Import CSV"
          subtitle="Pick a .csv file, review the preview, and import only the ready rows."
          leftIcon={<Ionicons name="download-outline" size={20} color={colors.primary} />}
          right={<Ionicons name="chevron-forward" size={20} color={colors.mutedText} />}
          onPress={() => router.push("/client-import" as any)}
        />
        <ListRow
          title="Export CSV"
          subtitle="Download all active clients for this signed-in account."
          leftIcon={<Ionicons name="share-outline" size={20} color={colors.primary} />}
          right={<Ionicons name="chevron-forward" size={20} color={colors.mutedText} />}
          onPress={() => {
            void handleExport();
          }}
        />
        <ListRow
          title="Download CSV template"
          subtitle="Start from Schedova’s header format for name, phone, email, notes, birthday, tag, and rebooking weeks."
          leftIcon={<Ionicons name="document-outline" size={20} color={colors.primary} />}
          right={<Ionicons name="chevron-forward" size={20} color={colors.mutedText} />}
          onPress={() => {
            void handleTemplateDownload();
          }}
        />
        <ListRow
          title="Find & merge duplicates"
          subtitle="Review possible duplicate client records and merge them safely."
          leftIcon={<Ionicons name="git-merge-outline" size={20} color={colors.primary} />}
          right={<Ionicons name="chevron-forward" size={20} color={colors.mutedText} />}
          onPress={() => router.push("/client-duplicates" as any)}
        />
      </View>
    </AppScreen>
  );
}
