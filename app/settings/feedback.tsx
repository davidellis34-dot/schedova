import { useLocalSearchParams, useRouter, useSegments } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
} from "../../components/ui";
import {
  FEEDBACK_TYPES,
  getFeedbackMetadata,
  openFeedbackEmailFallback,
  submitFeedback,
  type FeedbackType,
} from "../../lib/feedback";
import { useAppTheme } from "../../lib/useAppTheme";
import { trackAnalyticsEvent } from "../../lib/analytics";
import { validateFeedbackSubmission } from "../../lib/feedbackValidation";

export default function FeedbackScreen() {
  const router = useRouter();
  const segments = useSegments();
  const params = useLocalSearchParams<{ source?: string }>();
  const { colors } = useAppTheme();
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("Feature request");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [includeDeviceInfo, setIncludeDeviceInfo] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const submissionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    trackAnalyticsEvent("feedback_screen_viewed");
  }, []);

  async function handleSubmit() {
    if (submitting) return;
    const cleanTitle = title.trim();
    const cleanDescription = description.trim();

    const validationError = validateFeedbackSubmission({
      feedbackType,
      title: cleanTitle,
      description: cleanDescription,
    });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    setSubmitting(true);
    setErrorMessage("");
    const metadata = getFeedbackMetadata({
      includeDeviceInfo,
      sourceScreen: params.source || segments.join("/"),
    });
    const payload = {
      feedbackType,
      title: cleanTitle,
      description: cleanDescription,
      metadata,
      submissionKey:
        submissionKeyRef.current ||
        (submissionKeyRef.current = `feedback-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`),
    };

    try {
      await submitFeedback(payload);
      trackAnalyticsEvent("feedback_submitted");
      setSubmitted(true);
    } catch {
      try {
        await openFeedbackEmailFallback(payload);
        setSubmitted(true);
      } catch (fallbackError) {
        setErrorMessage(
          fallbackError instanceof Error
            ? fallbackError.message
            : "Feedback could not be sent right now. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <AppCard style={{ gap: 14 }}>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>Thank you</Text>
            <Text style={{ color: colors.mutedText, lineHeight: 22 }}>
              Your feedback has been sent to the Schedova team. We read every submission and use it to help improve the app.
            </Text>
            <AppButton title="Back to Settings" onPress={() => router.replace("/settings" as any)} />
          </AppCard>
        </View>
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAware backgroundColor={colors.background} horizontalPadding={24} bottomPadding={32}>
      <ScreenHeader title="Help Make Schedova Better" subtitle="Tell us what would make the app more useful for your business." />
      <AppCard style={{ gap: 16 }}>
        <Text style={{ color: colors.mutedText, lineHeight: 22 }}>
          Schedova is built for real businesses, and your feedback helps decide what we improve next.
        </Text>
        <Text style={{ color: colors.text, fontWeight: "900" }}>Feedback type</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {FEEDBACK_TYPES.map((type) => {
            const selected = type === feedbackType;
            return (
              <Pressable
                key={type}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFeedbackType(type)}
                style={({ pressed }) => ({
                  minHeight: 44,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? `${colors.primary}1A` : colors.background,
                  paddingHorizontal: 14,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ color: selected ? colors.primary : colors.text, fontWeight: "800" }}>{type}</Text>
              </Pressable>
            );
          })}
        </View>
        <AppTextInput label="Short title" value={title} onChangeText={setTitle} placeholder="What would make this better?" editable={!submitting} />
        <AppTextInput label="Description" value={description} onChangeText={setDescription} placeholder="Tell us what happened or what would help." multiline numberOfLines={6} textAlignVertical="top" editable={!submitting} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch value={includeDeviceInfo} onValueChange={setIncludeDeviceInfo} disabled={submitting} trackColor={{ true: colors.primary }} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text, fontWeight: "800" }}>Include app and device information</Text>
            <Text style={{ color: colors.mutedText, fontSize: 13, lineHeight: 18, marginTop: 3 }}>Version, platform, and device model when available. No client or message data is included.</Text>
          </View>
        </View>
        <Text style={{ color: colors.mutedText, fontSize: 13, lineHeight: 18 }}>Screenshot attachment is not included in this build. You can attach one from your email app if the secure feedback service is unavailable.</Text>
        {errorMessage ? <Text style={{ color: "#B91C1C", fontWeight: "700" }}>{errorMessage}</Text> : null}
        <AppButton title={submitting ? "Sending…" : "Send feedback"} onPress={() => void handleSubmit()} disabled={submitting} />
      </AppCard>
    </AppScreen>
  );
}
