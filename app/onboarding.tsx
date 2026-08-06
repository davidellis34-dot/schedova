import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import {
  getOnboardingState,
  markOnboardingComplete,
  markOnboardingSkipped,
  saveOnboardingState,
  type OnboardingDraft,
} from "../lib/onboarding";
import { settleActiveTextInput } from "../lib/settleTextInputs";
import { supabase } from "../lib/supabase";
import { useTrackedTextInputValue } from "../lib/textInputDraft";
import { useAppTheme } from "../lib/useAppTheme";
import { trackAnalyticsEvent } from "../lib/analytics";
import {
  buildSkippedOnboardingBusinessPayload,
  getOnboardingBusinessValidationError,
  resolveOnboardingResumeStep,
  shouldCreateOnboardingRecord,
} from "../lib/onboardingFlow";

const STEPS = [
  "Business",
  "Service",
  "Client",
  "Appointment",
  "SMS Review",
  "Ready",
] as const;

type ServiceRecord = {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
};

type ClientRecord = { id: string; name: string };

function todayDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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
  const serviceNameField = useTrackedTextInputValue("");
  const servicePriceField = useTrackedTextInputValue("");
  const serviceDurationField = useTrackedTextInputValue("30");
  const clientNameField = useTrackedTextInputValue("");
  const clientPhoneField = useTrackedTextInputValue("");
  const businessName = businessNameField.value;
  const businessType = businessTypeField.value;
  const serviceName = serviceNameField.value;
  const servicePrice = servicePriceField.value;
  const serviceDuration = serviceDurationField.value;
  const clientName = clientNameField.value;
  const clientPhone = clientPhoneField.value;
  const setBusinessName = businessNameField.onChangeText;
  const setBusinessType = businessTypeField.onChangeText;
  const setServiceName = serviceNameField.onChangeText;
  const setServicePrice = servicePriceField.onChangeText;
  const setServiceDuration = serviceDurationField.onChangeText;
  const setClientName = clientNameField.onChangeText;
  const setClientPhone = clientPhoneField.onChangeText;
  const hydrateBusinessName = businessNameField.setValue;
  const hydrateBusinessType = businessTypeField.setValue;
  const hydrateServiceName = serviceNameField.setValue;
  const hydrateServicePrice = servicePriceField.setValue;
  const hydrateServiceDuration = serviceDurationField.setValue;
  const hydrateClientName = clientNameField.setValue;
  const hydrateClientPhone = clientPhoneField.setValue;
  const [savedService, setSavedService] = useState<ServiceRecord | null>(null);
  const [savedClient, setSavedClient] = useState<ClientRecord | null>(null);

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

    const [businessResult, serviceResult, clientResult] = await Promise.all([
      nextState.draft.businessId
        ? supabase
            .from("businesses")
            .select("business_name, category")
            .eq("id", nextState.draft.businessId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      nextState.draft.serviceId
        ? supabase
            .from("services")
            .select("id, name, price, duration_minutes")
            .eq("id", nextState.draft.serviceId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      nextState.draft.clientId
        ? supabase
            .from("clients")
            .select("id, name, phone")
            .eq("id", nextState.draft.clientId)
            .eq("user_id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const business = businessResult.data as
      | { business_name?: string | null; category?: string | null }
      | null;
    const service = serviceResult.data as ServiceRecord | null;
    const client = clientResult.data as
      | { id: string; name?: string | null; phone?: string | null }
      | null;

    hydrateBusinessName(business?.business_name ?? "");
    hydrateBusinessType(business?.category ?? "");
    setSavedService(service);
    hydrateServiceName(service?.name ?? "");
    hydrateServicePrice(service ? String(service.price) : "");
    hydrateServiceDuration(
      service ? String(service.duration_minutes) : "30",
    );
    setSavedClient(client ? { id: client.id, name: client.name || "Client" } : null);
    hydrateClientName(client?.name ?? "");
    hydrateClientPhone(client?.phone ?? "");
  }, [
    hydrateBusinessName,
    hydrateBusinessType,
    hydrateClientName,
    hydrateClientPhone,
    hydrateServiceDuration,
    hydrateServiceName,
    hydrateServicePrice,
    isAccountReady,
    returnToSettings,
    router,
    userId,
  ]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  useFocusEffect(
    useCallback(() => {
      if (!userId || !draft?.clientId || !draft.serviceId || step !== 3) return;

      let active = true;
      void supabase
        .from("appointments")
        .select("id")
        .eq("user_id", userId)
        .eq("client_id", draft.clientId)
        .eq("service_id", draft.serviceId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(async ({ data }) => {
          if (!active || !data?.id) return;
          const next = await saveOnboardingState(userId, {
            draft: { appointmentId: data.id, step: 4 },
          });
          if (!draft.appointmentId) {
            trackAnalyticsEvent("first_appointment_created");
            trackAnalyticsEvent("onboarding_step_completed");
          }
          if (active) setDraft(next.draft);
        }, () => {
          // A follow-up read must not interrupt onboarding after booking.
        });

      return () => {
        active = false;
      };
    }, [
      draft?.appointmentId,
      draft?.clientId,
      draft?.serviceId,
      step,
      userId,
    ]),
  );

  async function updateDraft(update: Partial<OnboardingDraft>) {
    if (!userId) return;
    const next = await saveOnboardingState(userId, { draft: update });
    if (typeof update.step === "number" && update.step > step) {
      trackAnalyticsEvent("onboarding_step_completed");
    }
    setDraft(next.draft);
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
            .single()

      if (result.error || !result.data?.id) throw result.error || new Error("Business could not be saved.");
      await updateDraft({ businessId: result.data.id, step: 1 });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Business could not be saved.");
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
      router.replace("/dashboard" as any);
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

  async function saveService() {
    if (!userId || !draft || saving) return;

    await settleActiveTextInput();

    const name = serviceNameField.getValue().trim();
    const price = Number(servicePriceField.getValue());
    const duration = Number(serviceDurationField.getValue());
    if (!name || !Number.isFinite(price) || price < 0 || !Number.isFinite(duration) || duration <= 0) {
      setErrorMessage("Enter a service name, price, and duration greater than zero.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    try {
      const payload = { name, price, duration_minutes: Math.round(duration) };
      const result = shouldCreateOnboardingRecord(draft.serviceId)
        ? await supabase
            .from("services")
            .insert({ ...payload, user_id: userId })
            .select("id, name, price, duration_minutes")
            .single()
        : await supabase
            .from("services")
            .update(payload)
            .eq("id", draft.serviceId)
            .eq("user_id", userId)
            .select("id, name, price, duration_minutes")
            .single()

      if (result.error || !result.data?.id) throw result.error || new Error("Service could not be saved.");
      setSavedService(result.data as ServiceRecord);
      if (!draft.serviceId) trackAnalyticsEvent("first_service_created");
      await updateDraft({ serviceId: result.data.id, step: 2 });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Service could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function saveClient() {
    if (!userId || !draft || saving) return;

    await settleActiveTextInput();

    const name = clientNameField.getValue().trim();
    if (!name) {
      setErrorMessage("Enter a client name or choose Skip for now.");
      return;
    }

    setSaving(true);
    setErrorMessage("");
    try {
      const payload = {
        name,
        phone: clientPhoneField.getValue().trim() || null,
      };
      const result = shouldCreateOnboardingRecord(draft.clientId)
        ? await supabase
            .from("clients")
            .insert({ ...payload, user_id: userId })
            .select("id, name")
            .single()
        : await supabase
            .from("clients")
            .update(payload)
            .eq("id", draft.clientId)
            .eq("user_id", userId)
            .select("id, name")
            .single()

      if (result.error || !result.data?.id) throw result.error || new Error("Client could not be saved.");
      setSavedClient(result.data as ClientRecord);
      if (!draft.clientId) trackAnalyticsEvent("first_client_created");
      await updateDraft({ clientId: result.data.id, step: 3 });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Client could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function skipCurrentStep() {
    if (!draft) return;
    void updateDraft({ step: Math.min(step + 1, 5) });
  }

  function goBack() {
    if (!draft || saving || step <= 0) return;
    void updateDraft({ step: Math.max(0, step - 1) });
  }

  function openFirstAppointment() {
    if (!savedClient?.id || !savedService?.id) {
      Alert.alert("Add a service and client first", "You can book an appointment once those two steps are complete.");
      return;
    }

    void updateDraft({ step: 3 });
    router.push({
      pathname: "/book-appointment",
      params: {
        clientId: savedClient.id,
        serviceId: savedService.id,
        appointmentDate: todayDate(),
        returnTo: "/onboarding",
      },
    } as any);
  }

  if (!draft || !isAccountReady) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "800" }}>Preparing your setup…</Text>
        </View>
      </AppScreen>
    );
  }

  const progress = `${step + 1} of ${STEPS.length}`;

  return (
    <AppScreen scroll keyboardAware backgroundColor={colors.background} horizontalPadding={24} bottomPadding={32}>
      <ScreenHeader title="Set up Schedova" subtitle="A few quick steps to get your first appointment booked." />
      <View style={{ flexDirection: "row", gap: 6, marginBottom: 20 }}>
        {STEPS.map((label, index) => (
          <View key={label} style={{ flex: 1, height: 6, borderRadius: 999, backgroundColor: index <= step ? colors.primary : colors.border }} />
        ))}
      </View>
      <Text style={{ color: colors.mutedText, fontWeight: "800", marginBottom: 10 }}>{progress} · {STEPS[step]}</Text>
      <AppCard style={{ gap: 16 }}>
        {step === 0 ? <>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Business setup</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>Add the name clients will recognize. The business type is optional.</Text>
          <AppTextInput label="Business name" value={businessName} onChangeText={setBusinessName} placeholder="Elite Cuts" editable={!saving} />
          <AppTextInput label="Business type (optional)" value={businessType} onChangeText={setBusinessType} placeholder="Barber, stylist, nail tech…" editable={!saving} />
        </> : null}
        {step === 1 ? <>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Add your first service</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>You can add more services any time.</Text>
          <AppTextInput label="Service name" value={serviceName} onChangeText={setServiceName} placeholder="Haircut" editable={!saving} />
          <AppTextInput label="Price" value={servicePrice} onChangeText={setServicePrice} placeholder="35" keyboardType="decimal-pad" editable={!saving} />
          <AppTextInput label="Duration (minutes)" value={serviceDuration} onChangeText={setServiceDuration} placeholder="30" keyboardType="number-pad" editable={!saving} />
        </> : null}
        {step === 2 ? <>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Add your first client</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>A phone number is optional. Add it later before texting this client.</Text>
          <AppTextInput label="Client name" value={clientName} onChangeText={setClientName} placeholder="Jordan Smith" editable={!saving} />
          <AppTextInput label="Phone number (optional)" value={clientPhone} onChangeText={setClientPhone} placeholder="(555) 555-5555" keyboardType="phone-pad" editable={!saving} />
        </> : null}
        {step === 3 ? <>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Book your first appointment</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>We’ll preselect {savedClient?.name || "your client"} and {savedService?.name || "your service"}. Choose the date and time, then save.</Text>
          <AppButton title="Book first appointment" onPress={openFirstAppointment} disabled={!savedClient || !savedService} />
          <Pressable onPress={skipCurrentStep} accessibilityRole="button" style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.primary, fontWeight: "800" }}>I’ll book one later</Text>
          </Pressable>
        </> : null}
        {step === 4 ? <>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "900" }}>Review SMS settings</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 21 }}>SMS is optional. Review the setup whenever you are ready to send appointment texts. You can always return here from Settings.</Text>
          <AppButton title="Review SMS Settings" variant="secondary" onPress={() => router.push("/settings/sms" as any)} />
          <AppButton title="Continue" onPress={() => void updateDraft({ step: 5 })} />
          <Pressable onPress={skipCurrentStep} accessibilityRole="button" style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.mutedText, fontWeight: "800" }}>Skip SMS for now</Text>
          </Pressable>
        </> : null}
        {step === 5 ? <>
          <Text style={{ color: colors.text, fontSize: 28, fontWeight: "900" }}>Your business is ready.</Text>
          <Text style={{ color: colors.mutedText, lineHeight: 22 }}>Your dashboard will keep your bookings, clients, services, and next steps in one place.</Text>
          <AppButton title="Go to dashboard" onPress={() => void finish()} />
        </> : null}
        {errorMessage ? <Text style={{ color: "#B91C1C", fontWeight: "700" }}>{errorMessage}</Text> : null}
        {step > 0 && step < 5 ? (
          <AppButton
            title="Back"
            variant="ghost"
            onPress={goBack}
            disabled={saving}
          />
        ) : null}
        {[0, 1, 2].includes(step) ? <>
          <AppButton title={saving ? "Saving…" : "Save and continue"} onPress={() => {
            if (step === 0) void saveBusiness();
            if (step === 1) void saveService();
            if (step === 2) void saveClient();
          }} disabled={saving} />
          <Pressable onPress={() => {
            if (step === 0) {
              void skipBusinessSetupForNow();
              return;
            }

            skipCurrentStep();
          }} accessibilityRole="button" style={{ minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.mutedText, fontWeight: "800" }}>Skip for now</Text>
          </Pressable>
        </> : null}
      </AppCard>
    </AppScreen>
  );
}
