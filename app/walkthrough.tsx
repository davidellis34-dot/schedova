import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  BackHandler,
  Platform,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from "react-native";

import {
  AppButton,
  AppCard,
  AppScreen,
  LoadingCard,
} from "../components/ui";
import { useAuthSession } from "../lib/authSession";
import { getOnboardingState } from "../lib/onboarding";
import { useAppTheme } from "../lib/useAppTheme";
import {
  getWalkthroughExitRoute,
  getNextWalkthroughStep,
  getPreviousWalkthroughStep,
  resolveWalkthroughResumeStep,
  WALKTHROUGH_SCREEN_COUNT,
} from "../lib/walkthroughFlow";
import {
  getWalkthroughState,
  markWalkthroughComplete,
  saveWalkthroughState,
  type WalkthroughState,
} from "../lib/walkthrough";

type WalkthroughVisualKind =
  | "welcome"
  | "connected"
  | "booking"
  | "dashboard"
  | "records"
  | "messages"
  | "plans"
  | "next";

type WalkthroughPage = {
  title: string;
  description: string;
  supporting?: string;
  note: string;
  visual: WalkthroughVisualKind;
};

const WALKTHROUGH_PAGES: WalkthroughPage[] = [
  {
    title: "Welcome to Schedova",
    description:
      "Schedova helps you manage clients, services, appointments, and business messages from one place.",
    supporting:
      "It is designed for independent service providers and small businesses that need a simple way to stay organized.",
    note: "You will set up your business in a few guided steps after this walkthrough.",
    visual: "welcome",
  },
  {
    title: "Clients, services, and appointments work together",
    description:
      "Add the services you offer, then add your clients. When you book an appointment, choose the client, service, date, and time.",
    note: "You can edit clients, services, and appointments later.",
    visual: "connected",
  },
  {
    title: "Book appointments in a few taps",
    description:
      "Use the dashboard, calendar, or appointment list to schedule a client.",
    supporting:
      "Phone numbers are optional unless you want to send the client an SMS.",
    note: "After saving, the appointment appears on your calendar and dashboard.",
    visual: "booking",
  },
  {
    title: "See what needs your attention",
    description:
      "The dashboard brings together today's appointments, upcoming work, client and service totals, business activity, messages, and your SMS balance.",
    supporting:
      "Use Today, Quick Actions, the business snapshot, and the setup checklist to move through your day.",
    note: "Tap a card or button to open the related screen, including unread replies and SMS balance.",
    visual: "dashboard",
  },
  {
    title: "Keep client and service information organized",
    description:
      "Client profiles hold contact details, appointment history, and supported profile notes. Services keep the price and duration used while booking.",
    note: "Add at least one service and one client before booking your first appointment.",
    visual: "records",
  },
  {
    title: "Stay connected with clients",
    description:
      "Schedova can send appointment texts and organize client replies. SMS must be configured first, and each client needs a phone number and consent.",
    supporting:
      "Messaging can be set up during onboarding or later in Settings. It is never enabled automatically.",
    note: "Message sending uses SMS credits. Client replies appear in Messages, and temporary errors can be retried.",
    visual: "messages",
  },
  {
    title: "Optional tools for growing businesses",
    description:
      "Schedova Pro unlocks additional business features. SMS Message Packs are separate one-time purchases used for sending texts.",
    supporting:
      "Available plan choices and any eligible trial details are shown directly on the Schedova Pro screen.",
    note: "You can use the core app before deciding whether an optional upgrade is right for your business.",
    visual: "plans",
  },
  {
    title: "Let's set up your business",
    description:
      "Next, Schedova will guide you through the important setup steps. You can skip optional details and finish them later from the dashboard checklist.",
    note: "Business information, first service, first client, first appointment, SMS settings review, then you are ready.",
    visual: "next",
  },
];

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getRequestedWalkthroughStep(value: string | string[] | undefined) {
  const requested = Number(readParam(value));
  if (!Number.isInteger(requested) || requested < 1) return 0;
  return resolveWalkthroughResumeStep(requested - 1);
}

function VisualLabel({ children }: { children: string }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        borderColor: colors.border,
        borderRadius: 12,
        borderWidth: 1,
        backgroundColor: colors.card,
        minHeight: 44,
        justifyContent: "center",
        paddingHorizontal: 10,
      }}
    >
      <Text
        numberOfLines={2}
        style={{ color: colors.text, fontSize: 12, fontWeight: "800", textAlign: "center" }}
      >
        {children}
      </Text>
    </View>
  );
}

function WalkthroughVisual({ visual }: { visual: WalkthroughVisualKind }) {
  const { colors } = useAppTheme();

  const panelStyle = {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    minHeight: 186,
    overflow: "hidden" as const,
    padding: 16,
  };

  if (visual === "welcome") {
    return (
      <View style={panelStyle}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 14,
              alignItems: "center",
              backgroundColor: colors.primary,
              justifyContent: "center",
            }}
          >
            <Text style={{ color: "#FFFFFF", fontSize: 22, fontWeight: "900" }}>S</Text>
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 17, fontWeight: "900" }}>Schedova</Text>
            <Text style={{ color: colors.mutedText, fontSize: 12 }}>Your day at a glance</Text>
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {["Today", "Clients", "SMS"].map((label) => (
            <View key={label} style={{ flex: 1, backgroundColor: colors.card, borderRadius: 12, padding: 10 }}>
              <Text style={{ color: colors.mutedText, fontSize: 11 }}>{label}</Text>
              <Text style={{ color: colors.text, fontSize: 19, fontWeight: "900", marginTop: 5 }}>
                {label === "Today" ? "3" : label === "Clients" ? "24" : "120"}
              </Text>
            </View>
          ))}
        </View>
        <View style={{ backgroundColor: `${colors.primary}26`, borderRadius: 12, marginTop: 12, padding: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "800" }}>Quick Actions: Book Appointment, Add Client, Add Service</Text>
        </View>
      </View>
    );
  }

  if (visual === "connected") {
    return (
      <View style={[panelStyle, { justifyContent: "center", gap: 12 }]}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}><VisualLabel>Service</VisualLabel></View>
          <Text style={{ color: colors.primary, fontSize: 22, fontWeight: "900" }}>+</Text>
          <View style={{ flex: 1 }}><VisualLabel>Client</VisualLabel></View>
        </View>
        <View style={{ alignItems: "center" }}><Text style={{ color: colors.mutedText, fontWeight: "900" }}>+</Text></View>
        <VisualLabel>Date and time</VisualLabel>
        <View style={{ alignItems: "center" }}><Text style={{ color: colors.primary, fontSize: 22, fontWeight: "900" }}>=</Text></View>
        <View style={{ backgroundColor: colors.primary, borderRadius: 12, minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}>
          <Text style={{ color: "#FFFFFF", fontWeight: "900", textAlign: "center" }}>Appointment</Text>
        </View>
      </View>
    );
  }

  if (visual === "booking") {
    return (
      <View style={[panelStyle, { gap: 8 }]}>
        {["Choose a client", "Choose a service", "Select date and time", "Review details", "Save appointment"].map((label, index) => (
          <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 26, height: 26, alignItems: "center", backgroundColor: index === 4 ? colors.primary : colors.card, borderColor: colors.border, borderRadius: 13, borderWidth: 1, justifyContent: "center" }}>
              <Text style={{ color: index === 4 ? "#FFFFFF" : colors.text, fontSize: 12, fontWeight: "900" }}>{index + 1}</Text>
            </View>
            <Text style={{ color: colors.text, fontWeight: index === 4 ? "900" : "700" }}>{label}</Text>
          </View>
        ))}
      </View>
    );
  }

  if (visual === "dashboard") {
    return (
      <View style={[panelStyle, { gap: 10 }]}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><VisualLabel>Today summary</VisualLabel></View>
          <View style={{ flex: 1 }}><VisualLabel>SMS balance</VisualLabel></View>
        </View>
        <View style={{ backgroundColor: colors.card, borderColor: colors.border, borderRadius: 12, borderWidth: 1, padding: 12 }}>
          <Text style={{ color: colors.text, fontWeight: "900" }}>Quick Actions</Text>
          <Text style={{ color: colors.mutedText, fontSize: 12, marginTop: 4 }}>Book an appointment, add a client, or add a service.</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><VisualLabel>Unread replies</VisualLabel></View>
          <View style={{ flex: 1 }}><VisualLabel>Setup checklist</VisualLabel></View>
        </View>
      </View>
    );
  }

  if (visual === "records") {
    return (
      <View style={[panelStyle, { flexDirection: "row", gap: 10 }]}>
        <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14, borderWidth: 1, padding: 12 }}>
          <Ionicons name="person-outline" size={23} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "900", marginTop: 10 }}>Client</Text>
          <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 4 }}>Name, phone, notes, and appointment history.</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14, borderWidth: 1, padding: 12 }}>
          <Ionicons name="cut-outline" size={23} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "900", marginTop: 10 }}>Service</Text>
          <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 4 }}>Name, price, duration, and optional rebooking interval.</Text>
        </View>
      </View>
    );
  }

  if (visual === "messages") {
    return (
      <View style={[panelStyle, { gap: 10 }]}>
        <View style={{ alignSelf: "flex-start", backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14, borderWidth: 1, maxWidth: "82%", padding: 10 }}>
          <Text style={{ color: colors.text, fontSize: 13 }}>Can I move my appointment?</Text>
        </View>
        <View style={{ alignSelf: "flex-end", backgroundColor: colors.primary, borderRadius: 14, maxWidth: "82%", padding: 10 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 13 }}>{"Yes. Let's find a new time."}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: "auto" }}>
          <Ionicons name="chatbubble-ellipses-outline" size={19} color={colors.primary} />
          <Text style={{ color: colors.mutedText, fontSize: 12, flex: 1 }}>Configure SMS, add a phone number, and keep enough message credits.</Text>
        </View>
      </View>
    );
  }

  if (visual === "plans") {
    return (
      <View style={[panelStyle, { flexDirection: "row", gap: 10 }]}>
        <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.primary, borderRadius: 14, borderWidth: 1, padding: 12 }}>
          <Ionicons name="sparkles-outline" size={22} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "900", marginTop: 10 }}>Schedova Pro</Text>
          <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 4 }}>Optional subscription features for your business.</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: colors.card, borderColor: colors.border, borderRadius: 14, borderWidth: 1, padding: 12 }}>
          <Ionicons name="chatbubbles-outline" size={22} color={colors.primary} />
          <Text style={{ color: colors.text, fontWeight: "900", marginTop: 10 }}>Message Packs</Text>
          <Text style={{ color: colors.mutedText, fontSize: 12, lineHeight: 17, marginTop: 4 }}>Separate one-time credits for sending SMS.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[panelStyle, { gap: 8, justifyContent: "center" }]}>
      {["Business information", "First service", "First client", "First appointment", "SMS settings review", "Setup complete"].map((label, index) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ width: 24, height: 24, alignItems: "center", backgroundColor: colors.primary, borderRadius: 12, justifyContent: "center" }}>
            <Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "900" }}>{index + 1}</Text>
          </View>
          <Text style={{ color: colors.text, fontWeight: "700" }}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export default function WalkthroughScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ from?: string; screen?: string }>();
  const { colors } = useAppTheme();
  const { isAccountReady, userId } = useAuthSession();
  const { width } = useWindowDimensions();
  const [state, setState] = useState<WalkthroughState | null>(null);
  const [screenIndex, setScreenIndex] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const contentOpacity = useRef(new Animated.Value(1)).current;
  const contentTranslateX = useRef(new Animated.Value(0)).current;
  const latestUserIdRef = useRef<string | null>(userId);
  const replayMode = readParam(params.from) === "settings" || readParam(params.from) === "qa";

  latestUserIdRef.current = userId;

  useEffect(() => {
    let active = true;

    if (!isAccountReady || !userId) {
      setState(null);
      return () => {
        active = false;
      };
    }

    void getWalkthroughState(userId).then((nextState) => {
      if (!active || latestUserIdRef.current !== userId) return;

      if (nextState.completed && !replayMode) {
        router.replace("/dashboard" as any);
        return;
      }

      const requestedStep = getRequestedWalkthroughStep(params.screen);
      setState(nextState);
      setScreenIndex(replayMode ? requestedStep : nextState.step);
    });

    return () => {
      active = false;
    };
  }, [isAccountReady, params.screen, replayMode, router, userId]);

  const persistStep = useCallback(
    (nextStep: number) => {
      if (!userId) return;

      void saveWalkthroughState(userId, {
        started: true,
        step: nextStep,
      })
        .then((nextState) => {
          if (latestUserIdRef.current === userId) {
            setState(nextState);
          }
        })
        .catch(() => {
          // The screen remains usable if local persistence is temporarily unavailable.
        });
    },
    [userId],
  );

  const goToStep = useCallback(
    (nextStep: number) => {
      if (transitioning || nextStep === screenIndex) return;

      const direction = nextStep > screenIndex ? 1 : -1;
      setTransitioning(true);
      Animated.parallel([
        Animated.timing(contentOpacity, {
          toValue: 0,
          duration: 110,
          useNativeDriver: true,
        }),
        Animated.timing(contentTranslateX, {
          toValue: -12 * direction,
          duration: 110,
          useNativeDriver: true,
        }),
      ]).start(() => {
        setScreenIndex(nextStep);
        persistStep(nextStep);
        contentTranslateX.setValue(12 * direction);
        Animated.parallel([
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 170,
            useNativeDriver: true,
          }),
          Animated.timing(contentTranslateX, {
            toValue: 0,
            duration: 170,
            useNativeDriver: true,
          }),
        ]).start(() => setTransitioning(false));
      });
    },
    [contentOpacity, contentTranslateX, persistStep, screenIndex, transitioning],
  );

  const finishWalkthrough = useCallback(
    async (startSetup: boolean) => {
      if (!userId || transitioning) return;

      setTransitioning(true);
      try {
        await markWalkthroughComplete(userId);
        if (latestUserIdRef.current !== userId) return;

        const onboardingState = await getOnboardingState(userId);
        if (latestUserIdRef.current !== userId) return;

        router.replace(getWalkthroughExitRoute(startSetup, onboardingState.completed));
      } finally {
        if (latestUserIdRef.current === userId) {
          setTransitioning(false);
        }
      }
    },
    [router, transitioning, userId],
  );

  useEffect(() => {
    if (Platform.OS !== "android") return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (screenIndex <= 0 || transitioning) return false;
      goToStep(getPreviousWalkthroughStep(screenIndex));
      return true;
    });

    return () => subscription.remove();
  }, [goToStep, screenIndex, transitioning]);

  if (!state || !isAccountReady) {
    return (
      <AppScreen backgroundColor={colors.background} horizontalPadding={24}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <LoadingCard label="Preparing your Schedova introduction..." lines={3} />
        </View>
      </AppScreen>
    );
  }

  const page = WALKTHROUGH_PAGES[screenIndex] || WALKTHROUGH_PAGES[0];
  const isLastScreen = screenIndex === WALKTHROUGH_SCREEN_COUNT - 1;
  const maxWidth = width >= 720 ? 640 : undefined;

  return (
    <AppScreen
      scroll
      backgroundColor={colors.background}
      horizontalPadding={20}
      bottomPadding={32}
      contentContainerStyle={{ alignSelf: "center", maxWidth, width: "100%" }}
    >
      <View style={{ alignItems: "flex-end", minHeight: 44, justifyContent: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip walkthrough for now"
          disabled={transitioning}
          onPress={() => void finishWalkthrough(false)}
          style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", opacity: pressed || transitioning ? 0.6 : 1, paddingHorizontal: 8 })}
        >
          <Text style={{ color: colors.primary, fontWeight: "900" }}>Skip for Now</Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 5, marginBottom: 14 }}>
        {WALKTHROUGH_PAGES.map((item, index) => (
          <View
            key={item.title}
            style={{
              backgroundColor: index <= screenIndex ? colors.primary : colors.border,
              borderRadius: 999,
              flex: 1,
              height: 5,
            }}
          />
        ))}
      </View>

      <Text style={{ color: colors.mutedText, fontSize: 13, fontWeight: "800", marginBottom: 14 }}>
        {screenIndex + 1} of {WALKTHROUGH_SCREEN_COUNT}
      </Text>

      <Animated.View style={{ opacity: contentOpacity, transform: [{ translateX: contentTranslateX }] }}>
        <AppCard style={{ gap: 18 }}>
          <WalkthroughVisual visual={page.visual} />
          <View>
            <Text style={{ color: colors.text, fontSize: 27, fontWeight: "900", lineHeight: 34 }}>
              {page.title}
            </Text>
            <Text style={{ color: colors.mutedText, fontSize: 16, lineHeight: 23, marginTop: 10 }}>
              {page.description}
            </Text>
            {page.supporting ? (
              <Text style={{ color: colors.mutedText, fontSize: 14, lineHeight: 21, marginTop: 8 }}>
                {page.supporting}
              </Text>
            ) : null}
          </View>
          <View style={{ backgroundColor: `${colors.primary}18`, borderColor: `${colors.primary}55`, borderRadius: 14, borderWidth: 1, padding: 12 }}>
            <Text style={{ color: colors.text, fontSize: 13, fontWeight: "900" }}>What you can do</Text>
            <Text style={{ color: colors.mutedText, fontSize: 13, lineHeight: 19, marginTop: 4 }}>
              {page.note}
            </Text>
          </View>
        </AppCard>
      </Animated.View>

      <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
        <AppButton
          title="Back"
          variant="secondary"
          fullWidth={false}
          disabled={screenIndex === 0 || transitioning}
          onPress={() => goToStep(getPreviousWalkthroughStep(screenIndex))}
          style={{ flex: 1, minHeight: 48 }}
        />
        <AppButton
          title={isLastScreen ? "Start Setup" : "Next"}
          fullWidth={false}
          loading={transitioning && isLastScreen}
          disabled={transitioning}
          onPress={() => {
            if (isLastScreen) {
              void finishWalkthrough(true);
              return;
            }
            goToStep(getNextWalkthroughStep(screenIndex));
          }}
          style={{ flex: 1, minHeight: 48 }}
        />
      </View>

      {isLastScreen ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip setup and open dashboard"
          disabled={transitioning}
          onPress={() => void finishWalkthrough(false)}
          style={({ pressed }) => ({ alignItems: "center", minHeight: 44, justifyContent: "center", marginTop: 8, opacity: pressed || transitioning ? 0.6 : 1 })}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "800" }}>Skip setup for now</Text>
        </Pressable>
      ) : null}
    </AppScreen>
  );
}
