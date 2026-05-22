import { router } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { canUseFeature } from "../../lib/featureAccess";
import { useAppTheme } from "../../lib/useAppTheme";

const TEMPLATES = [
  {
    title: "Appointment confirmation",
    body: "Hi {client}, confirming your appointment for {date} at {time}. Reply here if you need to make a change.",
  },
  {
    title: "Running late",
    body: "Hi {client}, I am running a few minutes late and will update you if that changes. Thank you for your patience.",
  },
  {
    title: "Cancellation/reschedule",
    body: "Hi {client}, we need to cancel or reschedule your appointment on {date}. Please reply with a time that works for you.",
  },
];

export default function MessageTemplatesScreen() {
  const { colors } = useAppTheme();
  const unlimitedTemplatesAvailable = canUseFeature("unlimitedMessageTemplates");

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
    >
      <Pressable onPress={() => router.back()} style={{ marginBottom: 18 }}>
        <Text style={{ color: colors.primary, fontWeight: "800" }}>Back</Text>
      </Pressable>

      <Text
        style={{
          color: colors.text,
          fontSize: 30,
          fontWeight: "900",
          marginBottom: 8,
        }}
      >
        Message Templates
      </Text>

      {TEMPLATES.map((template) => (
        <View
          key={template.title}
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 16,
            marginBottom: 14,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontWeight: "900",
              marginBottom: 10,
            }}
          >
            {template.title}
          </Text>

          <Text
            selectable
            style={{
              color: colors.text,
              fontSize: 16,
              lineHeight: 22,
            }}
          >
            {template.body}
          </Text>
        </View>
      ))}

      {!unlimitedTemplatesAvailable ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 16,
            marginTop: 4,
          }}
        >
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontWeight: "900",
              marginBottom: 10,
            }}
          >
            Unlimited message templates
          </Text>

          <View style={{ flexDirection: "row", gap: 8 }}>
            <View
              style={{
                backgroundColor: colors.primary,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}
              >
                Pro
              </Text>
            </View>

            <View
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
              }}
            >
              <Text style={{ color: colors.text, fontSize: 12, fontWeight: "800" }}>
                Coming soon
              </Text>
            </View>
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
