import {
  resolveAuthenticatedAppBaseRoute,
  shouldUseExistingBusinessProfileFallback,
} from "./authRouteDecision";
import { recordAccountTransitionEvent } from "./accountTransition";

export type AuthenticatedAppRoute =
  | "/dashboard"
  | "/onboarding"
  | "/walkthrough"
  | {
      pathname: "/country-region";
      params: { next: "/dashboard" | "/onboarding" | "/walkthrough" };
    };

type AuthRouteDependencies = {
  getOnboardingState: (userId?: string | null) => Promise<{
    completed: boolean;
    started: boolean;
  }>;
  getWalkthroughState: (userId?: string | null) => Promise<{
    completed: boolean;
    started: boolean;
  }>;
  hasSelectedUserCountryRegion: () => Promise<boolean>;
  hasExistingBusinessProfile: (userId?: string | null) => Promise<boolean>;
};

async function getOnboardingStateDefault(userId?: string | null) {
  const { getOnboardingState } = await import("./onboarding");
  return getOnboardingState(userId);
}

async function getWalkthroughStateDefault(userId?: string | null) {
  const { getWalkthroughState } = await import("./walkthrough");
  return getWalkthroughState(userId);
}

async function hasSelectedUserCountryRegionDefault() {
  const { hasSelectedUserCountryRegion } = await import("./countrySettings");
  return hasSelectedUserCountryRegion();
}

async function hasExistingBusinessProfile(userId?: string | null) {
  if (!userId) return false;

  try {
    const { supabase } = await import("./supabase");
    const { data, error } = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      console.log("[AuthRouting] business profile lookup failed", error);
      recordAccountTransitionEvent("business_profile_fallback_warned", {
        reason: "lookup_failed",
      });
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.log("[AuthRouting] business profile lookup crashed", error);
    recordAccountTransitionEvent("business_profile_fallback_warned", {
      reason: "lookup_crashed",
    });
    return false;
  }
}

export async function resolveAuthenticatedAppRoute(
  userId?: string | null,
  dependencies: Partial<AuthRouteDependencies> = {},
): Promise<AuthenticatedAppRoute> {
  const {
    getOnboardingState: getOnboardingStateImpl = getOnboardingStateDefault,
    getWalkthroughState: getWalkthroughStateImpl = getWalkthroughStateDefault,
    hasSelectedUserCountryRegion: hasSelectedUserCountryRegionImpl =
      hasSelectedUserCountryRegionDefault,
    hasExistingBusinessProfile: hasExistingBusinessProfileImpl =
      hasExistingBusinessProfile,
  } = dependencies;

  const onboardingState = await getOnboardingStateImpl(userId);
  const walkthroughState = await getWalkthroughStateImpl(userId);
  const shouldUseBusinessFallback = shouldUseExistingBusinessProfileFallback({
    onboardingCompleted: onboardingState.completed,
    onboardingStarted: onboardingState.started,
    walkthroughCompleted: walkthroughState.completed,
    walkthroughStarted: walkthroughState.started,
  });
  const hasBusinessProfile = shouldUseBusinessFallback
    ? await (async () => {
        recordAccountTransitionEvent("business_profile_fallback_used", {
          source: "auth-routing",
        });
        return hasExistingBusinessProfileImpl(userId);
      })()
    : false;
  const nextRoute = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: onboardingState.completed,
    onboardingStarted: onboardingState.started,
    walkthroughCompleted: walkthroughState.completed,
    walkthroughStarted: walkthroughState.started,
    hasExistingBusinessProfile: hasBusinessProfile,
  });
  const hasCountryRegion = await hasSelectedUserCountryRegionImpl();

  const resolvedRoute: AuthenticatedAppRoute = hasCountryRegion
    ? nextRoute
    : {
        pathname: "/country-region",
        params: { next: nextRoute },
      };

  recordAccountTransitionEvent("authenticated_route_resolved", {
    baseRoute: nextRoute,
    countryRegionRequired: !hasCountryRegion,
    route:
      typeof resolvedRoute === "string"
        ? resolvedRoute
        : resolvedRoute.pathname,
  });

  return resolvedRoute;
}

export function getAuthRouteKey(route: AuthenticatedAppRoute | "/login") {
  const pathname = typeof route === "string" ? route : route.pathname;
  return pathname.replace(/^\/+/, "") || "index";
}
