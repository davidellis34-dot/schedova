import { hasSelectedUserCountryRegion } from "./countrySettings";
import { resolveAuthenticatedAppBaseRoute } from "./authRouteDecision";
import { getOnboardingState } from "./onboarding";
import { getWalkthroughState } from "./walkthrough";

export type AuthenticatedAppRoute =
  | "/dashboard"
  | "/onboarding"
  | "/walkthrough"
  | {
      pathname: "/country-region";
      params: { next: "/dashboard" | "/onboarding" | "/walkthrough" };
    };

type AuthRouteDependencies = {
  getOnboardingState: typeof getOnboardingState;
  getWalkthroughState: typeof getWalkthroughState;
  hasSelectedUserCountryRegion: typeof hasSelectedUserCountryRegion;
  hasExistingBusinessProfile: (userId?: string | null) => Promise<boolean>;
};

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
      return false;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.log("[AuthRouting] business profile lookup crashed", error);
    return false;
  }
}

export async function resolveAuthenticatedAppRoute(
  userId?: string | null,
  dependencies: Partial<AuthRouteDependencies> = {},
): Promise<AuthenticatedAppRoute> {
  const {
    getOnboardingState: getOnboardingStateImpl = getOnboardingState,
    getWalkthroughState: getWalkthroughStateImpl = getWalkthroughState,
    hasSelectedUserCountryRegion: hasSelectedUserCountryRegionImpl =
      hasSelectedUserCountryRegion,
    hasExistingBusinessProfile: hasExistingBusinessProfileImpl =
      hasExistingBusinessProfile,
  } = dependencies;

  const onboardingState = await getOnboardingStateImpl(userId);
  const walkthroughState = await getWalkthroughStateImpl(userId);
  const nextRoute = resolveAuthenticatedAppBaseRoute({
    onboardingCompleted: onboardingState.completed,
    onboardingStarted: onboardingState.started,
    walkthroughCompleted: walkthroughState.completed,
    walkthroughStarted: walkthroughState.started,
    hasExistingBusinessProfile: await hasExistingBusinessProfileImpl(userId),
  });

  if (!(await hasSelectedUserCountryRegionImpl())) {
    return {
      pathname: "/country-region",
      params: { next: nextRoute },
    };
  }

  return nextRoute;
}

export function getAuthRouteKey(route: AuthenticatedAppRoute | "/login") {
  const pathname = typeof route === "string" ? route : route.pathname;
  return pathname.replace(/^\/+/, "") || "index";
}
