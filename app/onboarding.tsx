import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
} from "../components/ui";
import { trackAnalyticsEvent } from "../lib/analytics";
import { useAuthSession } from "../lib/authSession";
import {
  getOnboardingState,
  markOnboardingComplete,
  markOnboardingSkipped,
  saveOnboardingState,
  type OnboardingDraft,
} from "../lib/onboarding";
import {
  buildSkippedOnboardingBusinessPayload,
  getOnboardingBusinessValidationError,
  ONBOARDING_FINAL_STEP,
  ONBOARDING_STEP_COUNT,
  resolveOnboardingResumeStep,
  shouldCreateOnboardingRecord,
} from "../lib/onboardingFlow";
import { settleActiveTextInput } from "../lib/settleTextInputs";
import { supabase } from "../lib/supabase";
import { useTrackedTextInputValue } from "../lib/textInputDraft";
import { useAppTheme } from "../lib/useAppTheme";

const STEPS = ["Business", "Ready"] as const;

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string }>();
  const { colors } = useAppTheme();
  const { isAccountReady, userId } = useAuthSession();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const businessNameField = useTrackedTextInputValue("");
  const businessTypeField = useTrackedTextInputValue("");
  const businessName = businessNameField.value;
  const businessType = businessTypeField.value;
  const setBusinessName = businessNameField.onChangeText;
  const setBusinessType = businessTypeField.onChangeText;
  const hydrateBusinessName = businessNameField.setValue;
  const hydrateBusinessType = businessTypeField.setValue;

  const step = resolveOnboardingResumeStep(draft?.step);
  const returnToSettings = params.from === "settings";

  const loadDraft = useCallback(async () => {
    if (!userId || !isAccountReady) return;

    const state = await getOnboardingState(userId);
    if (state.completed && !returnToSettings) {
      router.replace("/dashboard" as any);
      return;
    }

    const nextState = state.started
      ? state
      : await saveOnboardingState(userId, { started: true });
    if (!state.started) {
      trackAnalyticsEvent("onboarding_started");
    }
    setDraft(nextState.draft);

    if (!nextState.draft.businessId) {
      hydrateBusinessName("");
      hydrateBusinessType("");
      return;
    }

    const businessResult = await supabase
      .from("businesses")
      .select("business_name, category")
      .eq("id", nextState.draft.businessId)
      .eq("user_id", userId)
      .maybeSingle();

    const business = businessResult.data as
      | { business_name?: string | null; category?: string | null }
      | null;

    hydrateBusinessName(business?.business_name ?? "");
    hydrateBusinessType(business?.category ?? "");
  }, [
    hydrateBusinessName,
    hydrateBusinessType,
    isAccountReady,
    returnToSettings,
    router,
    userId,
  ]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);
  async function updateDraft(update: Partial<OnboardingDraft>) {
    if (!userId) return null;

    const next = await saveOnboardingState(userId, { draft: update });
    if (typeof update.step === "number" && update.step > step) {
      trackAnalyticsEvent("onboarding_step_completed");
    }
    setDraft(next.draft);
    return next;
  }

  async function finish() {
    if (!userId) return;

    await markOnboardingComplete(userId);
    trackAnalyticsEvent("onboarding_completed");
    router.replace(returnToSettings ? "/settings" : "/dashboard");
  }

  async function saveBusiness() {
    if (!userId || !draft || saving) return;

    await settleActiveTextInput();

    const validationError = getOnboardingBusinessValidationError({
      businessName: businessNameField.getValue(),
    });
    if (validationError) {
      setErrorMessage(validationError);
      return;
    }

    const name = businessNameField.getValue().trim();
    setSaving(true);
    setErrorMessage("");
    try {
      const payload = {
        business_name: name,
        category: businessTypeField.getValue().trim() || null,
      };
      const result = shouldCreateOnboardingRecord(draft.businessId)
        ? await supabase
            .from("businesses")
            .insert({ ...payload, user_id: userId })
            .select("id")
            .single()
        : await supabase
            .from("businesses")
            .update(payload)
            .eq("id", draft.businessId)
            .eq("user_id", userId)
            .select("id")
            .single();

      if (result.error || !result.data?.id) {
        throw result.error || new Error("Business could not be saved.");
      }

      await updateDraft({
        businessId: result.data.id,
        step: ONBOARDING_FINAL_STEP,
      });
      await finish();
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Business could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function skipBusinessSetupForNow() {
    if (!userId || !draft || saving) return;

    setSaving(true);
    setErrorMessage("");
    try {
      let businessId = String(draft.businessId || "").trim() || null;

      if (!businessId) {
        const { data, error } = await supabase
          .from("businesses")
          .select("id")
          .eq("user_id", userId)
          .limit(1);

        if (error) {
          throw error;
        }

        const existingBusiness = Array.isArray(data) ? data[0] : null;
        businessId =
          existingBusiness && typeof existingBusiness.id === "string"
            ? existingBusiness.id
            : null;
      }

      if (!businessId) {
        const { data, error } = await supabase
          .from("businesses")
          .insert({
            user_id: userId,
            ...buildSkippedOnboardingBusinessPayload({
              businessName: businessNameField.getValue(),
              businessType: businessTypeField.getValue(),
            }),
          })
          .select("id")
          .single();

        if (error || !data?.id) {
          throw error || new Error("Business setup could not be skipped.");
        }

        businessId = data.id;
      }

      await markOnboardingSkipped(userId, { businessId });
      trackAnalyticsEvent("onboarding_completed");
      router.replace(returnToSettings ? "/settings" : "/dashboard");
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Business setup could not be skipped.",
      );
    } finally {
      setSaving(false);
    }
  }

  function goBack() {
    if (!draft || saving || step <= 0) return;
    void updateDraft({ step: 0 });
  }

  if (!draft || !isAccountReady) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
          }}
        >
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "800" }}>
            Preparing your setup...
          </Text>
        </View>
      </AppScreen>
    );
  }

  const progress = `${step + 1} of ${ONBOARDING_STEP_COUNT}`;

  return (
    <AppScreen
      scroll
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={24}
      bottomPadding={32}
    >
      <ScreenHeader
        title="Set up Schedova"
        subtitle="Finish your business setup now, then add appointments from the dashboard."
      />
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 20 }}>
        {STEPS.map((label, index) => (
          <View
            key={label}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 999,
              backgroundColor: index <= step ? colors.primary : colors.border,
            }}
          />
        ))}
      </View>
      <Text
        style={{ color: colors.mutedText, fontWeight: "800", marginBottom: 10 }}
      >
        {progress} - {STEPS[step]}
      </Text>
      <AppCard style={{ gap: 16 }}>
        {step === 0 ? (
          <>
            <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>
              Business setup
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 21 }}>
              Add the name clients will recognize. The business type is optional.
            </Text>
            <AppTextInput
              label="Business name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Elite Cuts"
              editable={!saving}
            />
            <AppTextInput
              label="Business type (optional)"
              value={businessType}
              onChangeText={setBusinessType}
              placeholder="Barber, stylist, nail tech..."
              editable={!saving}
            />
          </>
        ) : (
          <>
            <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>
              You are ready to start booking.
            </Text>
            <Text style={{ color: colors.mutedText, lineHeight: 22 }}>
              Services, clients, appointments, and SMS setup can all be added
              from your dashboard when you are ready.
            </Text>
            <AppButton title="Go to dashboard" onPress={() => void finish()} />
          </>
        )}

        {errorMessage ? (
          <Text style={{ color: "#B91C1C", fontWeight: "700" }}>
            {errorMessage}
          </Text>
        ) : null}

        {step === 0 ? (
          <>
            <AppButton
              title={saving ? "Saving..." : "Complete onboarding"}
              onPress={() => void saveBusiness()}
              disabled={saving}
            />
            <Pressable
              onPress={() => void skipBusinessSetupForNow()}
              accessibilityRole="button"
              style={{
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
                Skip for now
              </Text>
            </Pressable>
          </>
        ) : (
          <AppButton
            title="Edit business details"
            variant="ghost"
            onPress={goBack}
            disabled={saving}
          />
        )}
      </AppCard>
    </AppScreen>
  );
}
