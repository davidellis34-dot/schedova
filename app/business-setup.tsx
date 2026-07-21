import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  InteractionManager,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import {
  resolveBusinessSetupScreenState,
  shouldApplyAccountScopedResult,
  shouldStartBusinessSetupSave,
} from "../lib/accountSwitchUtils";
import { recordAccountTransitionEvent } from "../lib/accountTransition";
import { useAuthSession } from "../lib/authSession";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

type BusinessProfile = {
  id: string | null;
  businessName: string;
  category: string;
};

type BusinessProfileState = {
  userId: string | null;
  loadedUserId: string | null;
  profile: BusinessProfile | null;
  error: string | null;
};

const EMPTY_BUSINESS_PROFILE_STATE: BusinessProfileState = {
  userId: null,
  loadedUserId: null,
  profile: null,
  error: null,
};

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readBusinessProfile(value: unknown): BusinessProfile | null {
  if (!value || typeof value !== "object") return null;

  const row = value as {
    id?: unknown;
    business_name?: unknown;
    category?: unknown;
  };

  return {
    id: typeof row.id === "string" ? row.id : null,
    businessName: readString(row.business_name),
    category: readString(row.category),
  };
}

async function settleBusinessSetupInputs() {
  // Blur once and wait for the native input hierarchy to settle before this
  // screen is unmounted. Calling blur and Keyboard.dismiss together can race
  // Fabric's own input teardown on iOS.
  const focusedInput = TextInput.State.currentlyFocusedInput?.();
  focusedInput?.blur?.();

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  return !TextInput.State.currentlyFocusedInput?.();
}

export default function BusinessSetup() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const uiColors = createSchedovaUiTheme(colors).colors;
  const { authStatus, isAccountReady, isHydrated, userId } = useAuthSession();
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("");
  const [profileState, setProfileState] = useState<BusinessProfileState>(
    EMPTY_BUSINESS_PROFILE_STATE,
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [reloadVersion, setReloadVersion] = useState(0);
  const mountedRef = useRef(true);
  const activeUserIdRef = useRef<string | null>(userId ?? null);
  const profileLoadIdRef = useRef(0);
  const saveRequestIdRef = useRef(0);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const formAccountUserIdRef = useRef<string | null>(null);
  const businessNameInputRef = useRef<TextInput | null>(null);
  const categoryInputRef = useRef<TextInput | null>(null);

  activeUserIdRef.current = userId ?? null;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      profileLoadIdRef.current += 1;
      saveRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const requestId = profileLoadIdRef.current + 1;
    profileLoadIdRef.current = requestId;
    const targetUserId = userId ?? null;

    if (formAccountUserIdRef.current !== targetUserId) {
      formAccountUserIdRef.current = targetUserId;
      saveRequestIdRef.current += 1;
      savePromiseRef.current = null;
      setSaving(false);
    }

    setBusinessName("");
    setCategory("");
    setErrorMessage("");
    setProfileState({
      userId: targetUserId,
      loadedUserId: null,
      profile: null,
      error: null,
    });

    if (
      !isHydrated ||
      authStatus !== "authenticated" ||
      !isAccountReady ||
      !targetUserId
    ) {
      return () => {
        cancelled = true;
      };
    }

    async function loadBusinessProfile() {
      try {
        const { data, error } = await supabase
          .from("businesses")
          .select("id, business_name, category")
          .eq("user_id", targetUserId)
          .limit(1);

        if (
          cancelled ||
          !mountedRef.current ||
          !shouldApplyAccountScopedResult({
            requestUserId: targetUserId,
            currentUserId: activeUserIdRef.current,
            requestId,
            currentRequestId: profileLoadIdRef.current,
          })
        ) {
          recordAccountTransitionEvent("previous-async-result-ignored", {
            source: "business-setup-profile",
            userId: targetUserId,
          });
          return;
        }

        if (error) {
          setProfileState({
            userId: targetUserId,
            loadedUserId: targetUserId,
            profile: null,
            error: "Business information could not be loaded. Try again.",
          });
          return;
        }

        const profile = readBusinessProfile(
          Array.isArray(data) ? data[0] : null,
        );
        setBusinessName(profile?.businessName ?? "");
        setCategory(profile?.category ?? "");
        setProfileState({
          userId: targetUserId,
          loadedUserId: targetUserId,
          profile,
          error: null,
        });
      } catch {
        if (
          cancelled ||
          !mountedRef.current ||
          !shouldApplyAccountScopedResult({
            requestUserId: targetUserId,
            currentUserId: activeUserIdRef.current,
            requestId,
            currentRequestId: profileLoadIdRef.current,
          })
        ) {
          recordAccountTransitionEvent("previous-async-result-ignored", {
            source: "business-setup-profile-error",
            userId: targetUserId,
          });
          return;
        }

        setProfileState({
          userId: targetUserId,
          loadedUserId: targetUserId,
          profile: null,
          error: "Business information could not be loaded. Try again.",
        });
      }
    }

    void loadBusinessProfile();

    return () => {
      cancelled = true;
    };
  }, [authStatus, isAccountReady, isHydrated, reloadVersion, userId]);

  const screenState = resolveBusinessSetupScreenState({
    isHydrated,
    isAccountReady: isAccountReady && authStatus === "authenticated",
    userId,
    loadedUserId: profileState.loadedUserId,
    error: profileState.error,
  });

  function isCurrentSave(targetUserId: string, requestId: number) {
    const current =
      mountedRef.current &&
      shouldApplyAccountScopedResult({
        requestUserId: targetUserId,
        currentUserId: activeUserIdRef.current,
        requestId,
        currentRequestId: saveRequestIdRef.current,
      });

    if (!current) {
      recordAccountTransitionEvent("previous-async-result-ignored", {
        source: "business-setup-save",
        userId: targetUserId,
      });
    }

    return current;
  }

  function handleSave() {
    if (
      !shouldStartBusinessSetupSave({
        hasInFlightSave: Boolean(savePromiseRef.current),
        isSaving: saving,
        screenState,
      })
    ) {
      return savePromiseRef.current ?? Promise.resolve();
    }

    const targetUserId = userId;
    const targetBusinessName = businessName.trim();
    const targetCategory = category.trim();

    if (!targetUserId || !isAccountReady) {
      setErrorMessage("Your account is still loading. Please wait a moment.");
      return Promise.resolve();
    }

    if (!targetBusinessName) {
      setErrorMessage("Enter your business name.");
      businessNameInputRef.current?.focus();
      return Promise.resolve();
    }

    const requestId = saveRequestIdRef.current + 1;
    saveRequestIdRef.current = requestId;
    setSaving(true);
    setErrorMessage("");

    let savePromise: Promise<void> | null = null;
    savePromise = (async () => {
      try {
        let businessId = profileState.profile?.id ?? null;

        if (!businessId) {
          const { data, error } = await supabase
            .from("businesses")
            .select("id")
            .eq("user_id", targetUserId)
            .limit(1);

          if (!isCurrentSave(targetUserId, requestId)) return;
          if (error) throw error;

          const existing = Array.isArray(data) ? data[0] : null;
          businessId =
            existing && typeof existing.id === "string" ? existing.id : null;
        }

        const payload = {
          business_name: targetBusinessName,
          category: targetCategory,
        };
        const result = businessId
          ? await supabase
              .from("businesses")
              .update(payload)
              .eq("id", businessId)
              .eq("user_id", targetUserId)
          : await supabase.from("businesses").insert({
              ...payload,
              user_id: targetUserId,
            });

        if (!isCurrentSave(targetUserId, requestId)) return;
        if (result.error) throw result.error;

        setProfileState({
          userId: targetUserId,
          loadedUserId: targetUserId,
          profile: {
            id: businessId,
            businessName: targetBusinessName,
            category: targetCategory,
          },
          error: null,
        });

        const inputsSettled = await settleBusinessSetupInputs();

        if (!isCurrentSave(targetUserId, requestId)) return;
        if (!inputsSettled) {
          setErrorMessage(
            "The keyboard is still closing. Please tap Continue once more.",
          );
          return;
        }
        router.replace("/dashboard" as any);
      } catch (error) {
        if (!isCurrentSave(targetUserId, requestId)) return;

        const detail =
          error instanceof Error && error.message
            ? error.message
            : "Business setup could not be saved. Please try again.";
        setErrorMessage(detail);
      } finally {
        if (isCurrentSave(targetUserId, requestId)) {
          setSaving(false);
        }

        if (savePromiseRef.current === savePromise) {
          savePromiseRef.current = null;
        }
      }
    })();

    savePromiseRef.current = savePromise;
    return savePromise;
  }

  if (screenState === "loading") {
    return (
      <AppScreen
        backgroundColor={colors.background}
        horizontalPadding={24}
        topPadding={24}
      >
        <View
          style={{
            alignItems: "center",
            flex: 1,
            justifyContent: "center",
            paddingHorizontal: 24,
          }}
        >
          <ActivityIndicator color={uiColors.primary} size="large" />
          <Text
            style={{
              color: colors.text,
              fontSize: 18,
              fontWeight: "800",
              marginTop: 16,
              textAlign: "center",
            }}
          >
            Loading business information...
          </Text>
          <Text
            style={{
              color: colors.mutedText,
              lineHeight: 20,
              marginTop: 8,
              textAlign: "center",
            }}
          >
            Your account is being prepared securely.
          </Text>
        </View>
      </AppScreen>
    );
  }

  const loadError = profileState.error;

  return (
    <AppScreen
      keyboardAware
      backgroundColor={colors.background}
      horizontalPadding={24}
      topPadding={24}
    >
      <ScreenHeader
        title="Set up your business"
        subtitle="Tell Schedova a little about your work so your schedule feels ready from day one."
      />

      <AppCard>
        <Text
          style={{
            color: colors.text,
            fontSize: 20,
            fontWeight: "900",
            marginBottom: 8,
          }}
        >
          Business details
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            lineHeight: 20,
            marginBottom: 18,
          }}
        >
          These details help personalize your appointment book.
        </Text>

        {loadError || errorMessage ? (
          <View
            style={{
              borderWidth: 1,
              borderColor: uiColors.destructive,
              backgroundColor: "rgba(220,38,38,0.12)",
              borderRadius: 14,
              padding: 12,
              marginBottom: 16,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "800",
                lineHeight: 20,
              }}
            >
              {errorMessage || loadError}
            </Text>
            {loadError ? (
              <AppButton
                title="Try Again"
                variant="ghost"
                onPress={() => setReloadVersion((current) => current + 1)}
                style={{ alignSelf: "flex-start", marginTop: 8 }}
              />
            ) : null}
          </View>
        ) : null}

        <AppTextInput
          ref={businessNameInputRef}
          label="Business name"
          value={businessName}
          onChangeText={setBusinessName}
          placeholder="Elite Cuts"
          editable={!saving}
        />

        <AppTextInput
          ref={categoryInputRef}
          label="Business category"
          helperText="Examples: barber, tattoo artist, nail tech, stylist."
          value={category}
          onChangeText={setCategory}
          placeholder="Barber, Tattoo, Nail Tech..."
          editable={!saving}
          containerStyle={{ marginBottom: 22 }}
        />

        <AppButton
          title="Continue"
          onPress={() => {
            void handleSave();
          }}
          loading={saving}
          disabled={saving}
        />
      </AppCard>
    </AppScreen>
  );
}
