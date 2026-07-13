import { useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "react-native";

import { EditClientForm } from "../components/clients/EditClientForm";
import { AppButton, AppCard, AppScreen, ScreenHeader } from "../components/ui";
import { useAppTheme } from "../lib/useAppTheme";

function normalizeRouteParam(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || "").trim();
}

export default function EditClientScreen() {
  const router = useRouter();
  const { clientId, returnTo } = useLocalSearchParams<{
    clientId?: string | string[];
    returnTo?: string | string[];
  }>();
  const { colors } = useAppTheme();
  const clientIdValue = normalizeRouteParam(clientId);
  const returnToValue = normalizeRouteParam(returnTo);

  function closeEditor() {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (returnToValue === "book-appointment") {
      router.replace("/book-appointment" as any);
      return;
    }

    router.replace("/clients" as any);
  }

  return (
    <AppScreen
      scroll
      keyboardAware
      backgroundColor={colors.background}
      keyboardShouldPersistTaps="handled"
      bottomPadding={64}
    >
      <ScreenHeader
        title="Edit Client"
        subtitle="Update client details and SMS preferences."
        showBack
      />

      {clientIdValue ? (
        <EditClientForm
          clientId={clientIdValue}
          onCancel={closeEditor}
          onSaved={closeEditor}
        />
      ) : (
        <>
          <AppCard style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 8,
              }}
            >
              Missing client ID
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 20 }}>
              This edit button did not include a valid client ID. Go back and
              try opening the client again.
            </Text>
          </AppCard>

          <AppButton title="Back" variant="secondary" onPress={closeEditor} />
        </>
      )}
    </AppScreen>
  );
}
