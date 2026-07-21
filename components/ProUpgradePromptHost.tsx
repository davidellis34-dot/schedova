import { useEffect, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, Text, View } from "react-native";

import { loadProPaywallSnapshot } from "../lib/proPaywallData";
import {
  dismissProUpgradePrompt,
  openSchedovaProScreen,
  subscribeToProUpgradePrompts,
  type ProUpgradePromptRequest,
} from "../lib/proUpsell";
import { useSubscription } from "../lib/revenuecat/SubscriptionProvider";

export function ProUpgradePromptHost() {
  const { customerInfo } = useSubscription();
  const [prompt, setPrompt] = useState<ProUpgradePromptRequest | null>(null);
  const [priceLine, setPriceLine] = useState("");
  const [ctaLabel, setCtaLabel] = useState("View Pro Plans");
  const [autoRenewNotice, setAutoRenewNotice] = useState("");

  useEffect(() => {
    return subscribeToProUpgradePrompts((nextPrompt) => {
      setPrompt(nextPrompt);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!prompt) {
      setPriceLine("");
      setCtaLabel("View Pro Plans");
      setAutoRenewNotice("");
      return () => {
        cancelled = true;
      };
    }

    void loadProPaywallSnapshot(customerInfo)
      .then((snapshot) => {
        if (cancelled) return;

        setPriceLine(snapshot.monthlyPlanCopy.priceLine);
        setCtaLabel(snapshot.monthlyPlanCopy.ctaLabel);
        setAutoRenewNotice(snapshot.monthlyPlanCopy.autoRenewNotice);
      })
      .catch(() => {
        if (cancelled) return;

        setPriceLine("");
        setCtaLabel("View Pro Plans");
        setAutoRenewNotice(
          "The App Store or Google Play will confirm the current renewal terms before checkout.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [customerInfo, prompt]);

  const title = prompt?.title || "Schedova Pro";
  const message = prompt?.message || "";
  const dismissLabel = prompt?.variant === "free-limit" ? "Maybe Later" : "Close";

  return (
    <Modal
      visible={Boolean(prompt)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissProUpgradePrompt}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(2, 6, 23, 0.72)",
          justifyContent: "center",
          paddingHorizontal: 18,
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={dismissProUpgradePrompt} />

        <View
          style={{
            backgroundColor: "#0F172A",
            borderRadius: 28,
            borderWidth: 1,
            borderColor: "rgba(45, 212, 191, 0.22)",
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: Platform.OS === "ios" ? 20 : 18,
            shadowColor: "#000000",
            shadowOpacity: 0.28,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 10 },
            elevation: 18,
          }}
        >
          <View
            style={{
              alignSelf: "center",
              width: 46,
              height: 5,
              borderRadius: 999,
              backgroundColor: "rgba(226, 232, 240, 0.24)",
              marginBottom: 18,
            }}
          />

          <ScrollView
            style={{ maxHeight: 320 }}
            contentContainerStyle={{ paddingBottom: 4 }}
            showsVerticalScrollIndicator={false}
          >
            <Text
              style={{
                color: "#F8FAFC",
                fontSize: 24,
                fontWeight: "900",
                lineHeight: 30,
              }}
            >
              {title}
            </Text>

            <Text
              style={{
                color: "rgba(226, 232, 240, 0.86)",
                fontSize: 16,
                lineHeight: 24,
                marginTop: 12,
              }}
            >
              {message}
            </Text>

            {priceLine ? (
              <Text
                style={{
                  color: "#5EEAD4",
                  fontSize: 15,
                  fontWeight: "800",
                  lineHeight: 22,
                  marginTop: 14,
                }}
              >
                {priceLine}
              </Text>
            ) : null}

            {autoRenewNotice ? (
              <Text
                style={{
                  color: "rgba(148, 163, 184, 0.96)",
                  fontSize: 13,
                  lineHeight: 20,
                  marginTop: 10,
                }}
              >
                {autoRenewNotice}
              </Text>
            ) : null}
          </ScrollView>

          <View style={{ marginTop: 20, gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                dismissProUpgradePrompt();
                openSchedovaProScreen();
              }}
              style={{
                minHeight: 54,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#0F766E",
                borderWidth: 1,
                borderColor: "#14B8A6",
              }}
            >
              <Text
                style={{
                  color: "#FFFFFF",
                  fontSize: 16,
                  fontWeight: "900",
                }}
              >
                {ctaLabel}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={dismissProUpgradePrompt}
              style={{
                minHeight: 50,
                borderRadius: 18,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(15, 23, 42, 0.72)",
                borderWidth: 1,
                borderColor: "rgba(148, 163, 184, 0.18)",
              }}
            >
              <Text
                style={{
                  color: "rgba(226, 232, 240, 0.92)",
                  fontSize: 15,
                  fontWeight: "800",
                }}
              >
                {dismissLabel}
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable style={{ flex: 1 }} onPress={dismissProUpgradePrompt} />
      </View>
    </Modal>
  );
}
