import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  EmptyState,
  ProGateCard,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../../components/ui";
import { canUseFeature, useFeatureAccess } from "../../lib/featureAccess";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  BUILT_IN_MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_VARIABLES,
  createCustomMessageTemplate,
  deleteCustomMessageTemplate,
  fetchCustomMessageTemplates,
  getMessageTemplatePreview,
  type MessageTemplate,
  updateCustomMessageTemplate,
} from "../../lib/messageTemplates";
import { openSchedovaProScreen, PRO_UPSELL_COPY } from "../../lib/proUpsell";
import { supabase } from "../../lib/supabase";
import { useAppTheme } from "../../lib/useAppTheme";

type TemplateFormState = {
  id: string | null;
  title: string;
  body: string;
  category: string;
};

const EMPTY_FORM: TemplateFormState = {
  id: null,
  title: "",
  body: "",
  category: "",
};

export default function MessageTemplatesScreen() {
  const { colors } = useAppTheme();
  const theme = createSchedovaUiTheme(colors);
  const { spacing, radii, typography } = theme;
  useFeatureAccess();
  const customTemplatesAvailable = canUseFeature("unlimitedMessageTemplates");

  const [userId, setUserId] = useState<string | null>(null);
  const [customTemplates, setCustomTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState("");
  const [form, setForm] = useState<TemplateFormState>(EMPTY_FORM);
  const [formVisible, setFormVisible] = useState(false);

  const formTitle = form.id ? "Edit template" : "Add template";
  const allTemplates = useMemo(
    () => [...BUILT_IN_MESSAGE_TEMPLATES, ...customTemplates],
    [customTemplates],
  );

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setLoadError("");

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        setUserId(null);
        setCustomTemplates([]);
        setLoadError("Please sign in to manage message templates.");
        return;
      }

      setUserId(user.id);
      const templates = await fetchCustomMessageTemplates(user.id);
      setCustomTemplates(templates);
    } catch (error: any) {
      console.log("LOAD MESSAGE TEMPLATES ERROR:", error?.message || error);
      setCustomTemplates([]);
      setLoadError(
        "Built-in templates are available. Custom templates could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadTemplates();
    }, [loadTemplates]),
  );

  function resetForm() {
    setForm(EMPTY_FORM);
    setFormVisible(false);
  }

  function ensureCustomTemplatesAvailable() {
    if (customTemplatesAvailable) {
      return true;
    }

    openSchedovaProScreen();
    return false;
  }

  function startNewTemplate() {
    if (!ensureCustomTemplatesAvailable()) return;

    setForm(EMPTY_FORM);
    setFormVisible(true);
  }

  function startDuplicateTemplate(template: MessageTemplate) {
    if (!ensureCustomTemplatesAvailable()) return;

    setForm({
      id: null,
      title: `${template.title} copy`,
      body: template.body,
      category: template.category || "",
    });
    setFormVisible(true);
  }

  function startEditTemplate(template: MessageTemplate) {
    if (template.source !== "custom") return;
    if (!ensureCustomTemplatesAvailable()) return;

    setForm({
      id: template.id,
      title: template.title,
      body: template.body,
      category: template.category || "",
    });
    setFormVisible(true);
  }

  async function copyTemplate(template: MessageTemplate) {
    try {
      await copyTextToClipboard(template.body);
    } catch (error) {
      console.error("Clipboard copy failed:", error);
      Alert.alert("Copy failed", "Unable to copy message. Please try again.");
    }
  }

  async function saveTemplate() {
    if (saving) return;

    const title = form.title.trim();
    const body = form.body.trim();
    const category = form.category.trim();

    if (!title || !body) {
      Alert.alert("Missing Info", "Add a template name and message body.");
      return;
    }

    if (!userId) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    if (!customTemplatesAvailable) {
      openSchedovaProScreen();
      return;
    }

    setSaving(true);

    try {
      if (form.id) {
        const updated = await updateCustomMessageTemplate({
          id: form.id,
          userId,
          title,
          body,
          category,
        });

        setCustomTemplates((currentTemplates) =>
          currentTemplates.map((template) =>
            template.id === updated.id ? updated : template,
          ),
        );
      } else {
        const created = await createCustomMessageTemplate({
          userId,
          title,
          body,
          category,
        });

        setCustomTemplates((currentTemplates) => [created, ...currentTemplates]);
      }

      resetForm();
    } catch (error: any) {
      console.log("SAVE MESSAGE TEMPLATE ERROR:", error?.message || error);
      Alert.alert(
        "Message Templates",
        "Message template could not be saved. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteTemplate(template: MessageTemplate) {
    if (template.source !== "custom") return;

    Alert.alert(
      "Delete template?",
      `Delete "${template.title}" from your custom templates?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteTemplate(template);
          },
        },
      ],
    );
  }

  async function deleteTemplate(template: MessageTemplate) {
    if (!userId || deletingId) return;

    setDeletingId(template.id);

    try {
      await deleteCustomMessageTemplate({ id: template.id, userId });
      setCustomTemplates((currentTemplates) =>
        currentTemplates.filter((item) => item.id !== template.id),
      );

      if (form.id === template.id) {
        resetForm();
      }
    } catch (error: any) {
      console.log("DELETE MESSAGE TEMPLATE ERROR:", error?.message || error);
      Alert.alert(
        "Message Templates",
        "Message template could not be deleted. Please try again.",
      );
    } finally {
      setDeletingId(null);
    }
  }

  function TemplateBadge({ label }: { label: string }) {
    return (
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: "rgba(15, 118, 110, 0.18)",
          borderColor: colors.primary,
          borderRadius: radii.pill,
          borderWidth: 1,
          paddingHorizontal: spacing.sm,
          paddingVertical: 3,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: typography.sizes.caption,
            fontWeight: typography.weights.heavy,
          }}
        >
          {label}
        </Text>
      </View>
    );
  }

  function TemplateCard({ template }: { template: MessageTemplate }) {
    const isBuiltIn = template.source === "builtin";
    const isDeleting = deletingId === template.id;

    return (
      <AppCard>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing.md,
            marginBottom: spacing.sm,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.cardTitle,
                fontWeight: typography.weights.heavy,
              }}
            >
              {template.title}
            </Text>
            {template.category ? (
              <Text
                style={{
                  color: colors.mutedText,
                  fontSize: typography.sizes.caption,
                  marginTop: spacing.xs,
                }}
              >
                {template.category}
              </Text>
            ) : null}
          </View>

          <TemplateBadge label={isBuiltIn ? "Built-in" : "Custom"} />
        </View>

        <Text
          style={{
            color: colors.mutedText,
            lineHeight: typography.lineHeights.body,
            marginBottom: spacing.lg,
          }}
        >
          {getMessageTemplatePreview(template.body)}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          <AppButton
            title="Use"
            variant="secondary"
            fullWidth={false}
            onPress={() => {
              void copyTemplate(template);
            }}
            style={{ flexGrow: 1 }}
          />
          {isBuiltIn ? (
            <AppButton
              title="Duplicate and edit"
              variant="secondary"
              fullWidth={false}
              onPress={() => startDuplicateTemplate(template)}
              style={{ flexGrow: 1 }}
            />
          ) : (
            <>
              <AppButton
                title="Edit"
                variant="secondary"
                fullWidth={false}
                onPress={() => startEditTemplate(template)}
                style={{ flexGrow: 1 }}
              />
              <AppButton
                title={isDeleting ? "Deleting..." : "Delete"}
                variant="destructive"
                fullWidth={false}
                loading={isDeleting}
                disabled={Boolean(deletingId)}
                onPress={() => confirmDeleteTemplate(template)}
                style={{ flexGrow: 1 }}
              />
            </>
          )}
        </View>
      </AppCard>
    );
  }

  if (!customTemplatesAvailable) {
    return (
      <AppScreen scroll keyboardAware backgroundColor={colors.background}>
        <ScreenHeader
          title="Message Templates"
          subtitle="Create reusable appointment messages for clients."
          showBack
        />

        <ProGateCard
          title="Custom message templates"
          message={PRO_UPSELL_COPY.messageTemplates}
          features={[
            "Save and edit reusable client messages",
            "Keep appointment messaging consistent",
            "Reuse polished booking and follow-up copy",
          ]}
          ctaLabel="Upgrade to Schedova Pro"
          onPress={openSchedovaProScreen}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAware backgroundColor={colors.background}>
      <ScreenHeader
        title="Message Templates"
        subtitle="Create reusable appointment messages for clients."
        showBack
      />

      <AppCard style={{ marginBottom: spacing.lg }}>
        <Text
          style={{
            color: colors.text,
            fontSize: typography.sizes.cardTitle,
            fontWeight: typography.weights.heavy,
            marginBottom: spacing.sm,
          }}
        >
          Starter messages
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            lineHeight: typography.lineHeights.body,
          }}
        >
          Create reusable messages for client updates, appointment
          confirmations, and follow-ups. Use them from a client or appointment
          screen, then copy the message or open your SMS app.
        </Text>

        <Text
          style={{
            color: colors.mutedText,
            fontSize: typography.sizes.helper,
            lineHeight: typography.lineHeights.helper,
            marginTop: spacing.md,
          }}
        >
          Supported variables: {MESSAGE_TEMPLATE_VARIABLES.join(", ")}
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            fontSize: typography.sizes.helper,
            lineHeight: typography.lineHeights.helper,
            marginTop: spacing.sm,
          }}
        >
          {`Use {add_to_schedova_link} only for links that open Schedova to finish booking. This is not a public client self-booking link.`}
        </Text>
      </AppCard>

      {loadError ? (
        <AppCard style={{ marginBottom: spacing.lg }}>
          <Text
            style={{
              color: colors.mutedText,
              lineHeight: typography.lineHeights.body,
            }}
          >
            {loadError}
          </Text>
        </AppCard>
      ) : null}

      <AppButton
        title={customTemplatesAvailable ? "Add Template" : "Unlock Custom Templates"}
        onPress={startNewTemplate}
        style={{ marginBottom: spacing.lg }}
      />

      {formVisible ? (
        <AppCard style={{ marginBottom: spacing.lg }}>
          <Text
            style={{
              color: colors.text,
              fontSize: typography.sizes.cardTitle,
              fontWeight: typography.weights.heavy,
              marginBottom: spacing.md,
            }}
          >
            {formTitle}
          </Text>

          <AppTextInput
            label="Template name"
            value={form.title}
            onChangeText={(title) =>
              setForm((currentForm) => ({ ...currentForm, title }))
            }
            placeholder="Follow-up message"
          />

          <AppTextInput
            label="Category"
            helperText="Optional. Examples: Confirmation, Follow-up, Update."
            value={form.category}
            onChangeText={(category) =>
              setForm((currentForm) => ({ ...currentForm, category }))
            }
            placeholder="Follow-up"
          />

          <AppTextInput
            label="Message body"
            value={form.body}
            onChangeText={(body) =>
              setForm((currentForm) => ({ ...currentForm, body }))
            }
            multiline
            placeholder="Hi {client_name}, ..."
          />

          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            <AppButton
              title={saving ? "Saving..." : "Save Template"}
              loading={saving}
              disabled={saving}
              onPress={saveTemplate}
              fullWidth={false}
              style={{ flex: 1 }}
            />
            <AppButton
              title="Cancel"
              variant="secondary"
              disabled={saving}
              onPress={resetForm}
              fullWidth={false}
              style={{ flex: 1 }}
            />
          </View>
        </AppCard>
      ) : null}

      <View style={{ gap: spacing.md, marginBottom: spacing.lg }}>
        {allTemplates.map((template) => (
          <TemplateCard key={template.id} template={template} />
        ))}
      </View>

      {!loading && customTemplates.length === 0 ? (
        <EmptyState
          title="No custom templates yet"
          message="Create a reusable message to save time when contacting clients."
          actionLabel="Add Template"
          onAction={startNewTemplate}
          style={{ marginBottom: spacing.lg }}
        />
      ) : null}

      {loading ? (
        <AppCard style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: colors.mutedText }}>
            Loading custom templates...
          </Text>
        </AppCard>
      ) : null}

    </AppScreen>
  );
}
