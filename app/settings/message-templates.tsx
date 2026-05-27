import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, Text, TextInput, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { canUseFeature, useFeatureAccess } from "../../lib/featureAccess";
import { useAppTheme } from "../../lib/useAppTheme";

const STORAGE_KEY = "schedova_message_templates_v1";

const TEMPLATES = [
  {
    id: "confirmation",
    title: "Appointment confirmation",
    body: "Hi {client}, confirming your appointment for {date} at {time}. Reply here if you need to make a change.",
  },
  {
    id: "running_late",
    title: "Running late",
    body: "Hi {client}, I am running a few minutes late and will update you if that changes. Thank you for your patience.",
  },
  {
    id: "cancellation",
    title: "Cancellation/reschedule",
    body: "Hi {client}, we need to cancel or reschedule your appointment on {date}. Please reply with a time that works for you.",
  },
];

function defaultTemplateBodies() {
  return TEMPLATES.reduce<Record<string, string>>((templates, template) => {
    templates[template.id] = template.body;
    return templates;
  }, {});
}

export default function MessageTemplatesScreen() {
  const { colors } = useAppTheme();
  useFeatureAccess();
  const unlimitedTemplatesAvailable = canUseFeature("unlimitedMessageTemplates");
  const [templateBodies, setTemplateBodies] = useState(defaultTemplateBodies);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void loadTemplates();
  }, []);

  async function loadTemplates() {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const parsed = JSON.parse(saved) as Record<string, string>;
      setTemplateBodies({
        ...defaultTemplateBodies(),
        ...parsed,
      });
    } catch {
      setTemplateBodies(defaultTemplateBodies());
    }
  }

  function updateTemplate(id: string, body: string) {
    setTemplateBodies((current) => ({
      ...current,
      [id]: body,
    }));
  }

  async function saveTemplates() {
    setSaving(true);

    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(templateBodies));
      Alert.alert("Saved", "Message templates updated.");
    } finally {
      setSaving(false);
    }
  }

  async function resetTemplates() {
    const defaults = defaultTemplateBodies();
    setTemplateBodies(defaults);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
  }

  return (
    <AppScreen scroll keyboardAware backgroundColor={colors.background}>
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
          key={template.id}
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

          <TextInput
            value={templateBodies[template.id] || ""}
            onChangeText={(body) => updateTemplate(template.id, body)}
            multiline
            textAlignVertical="top"
            placeholder="Template message"
            placeholderTextColor={colors.mutedText}
            style={{
              color: colors.text,
              fontSize: 16,
              lineHeight: 22,
              minHeight: 112,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 12,
              backgroundColor: colors.background,
            }}
          />
        </View>
      ))}

      <Pressable
        disabled={saving}
        onPress={saveTemplates}
        style={{
          backgroundColor: saving ? colors.mutedText : colors.primary,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "900" }}>
          {saving ? "Saving..." : "Save Templates"}
        </Text>
      </Pressable>

      <Pressable
        onPress={resetTemplates}
        style={{
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 16,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "900" }}>
          Reset Defaults
        </Text>
      </Pressable>

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
    </AppScreen>
  );
}
