import { hasSelectedUserCountryRegion } from "./countrySettings";
import { hasHandledFirstBookingActivation } from "./firstBookingActivation";
import {
  resolveFirstBookingActivationRoute,
  shouldRequireCountryRegionBeforeRoute,
} from "./firstBookingRouting";

export type AuthenticatedAppRoute =
  | "/dashboard"
  | "/onboarding"
  | "/walkthrough"
  | {
      pathname: "/country-region";
      params: { next: "/dashboard" | "/onboarding" | "/walkthrough" };
    };

type AuthRouteDependencies = {
  hasSelectedUserCountryRegion: typeof hasSelectedUserCountryRegion;
  hasExistingAppointment: (userId?: string | null) => Promise<boolean>;
  hasHandledFirstBookingActivation: typeof hasHandledFirstBookingActivation;
};

async function hasExistingAppointment(userId?: string | null) {
  if (!userId) return false;

  try {
    const { supabase } = await import("./supabase");
    const { data, error } = await supabase
      .from("appointments")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (error) {
      // Fail open. A temporary lookup problem must never trap a returning user
      // in first-booking setup.
      console.log("[AuthRouting] appointment lookup failed", error);
      return true;
    }

    return Array.isArray(data) && data.length > 0;
  } catch (error) {
    console.log("[AuthRouting] appointment lookup crashed", error);
    return true;
  }
}

export async function resolveAuthenticatedAppRoute(
  userId?: string | null,
  dependencies: Partial<AuthRouteDependencies> = {},
): Promise<AuthenticatedAppRoute> {
  const {
    hasSelectedUserCountryRegion: hasSelectedUserCountryRegionImpl =
      hasSelectedUserCountryRegion,
    hasExistingAppointment: hasExistingAppointmentImpl = hasExistingAppointment,
    hasHandledFirstBookingActivation:
      hasHandledFirstBookingActivationImpl =
        hasHandledFirstBookingActivation,
  } = dependencies;

  const [existingAppointment, activationHandled] = await Promise.all([
    hasExistingAppointmentImpl(userId),
    hasHandledFirstBookingActivationImpl(userId),
  ]);

  const nextRoute = resolveFirstBookingActivationRoute({
    hasExistingAppointment: existingAppointment,
    activationHandled,
  });

  // Do not make a new user finish account setup before seeing value. Phone is
  // optional in quick start, and local formatting can be completed later.
  if (!shouldRequireCountryRegionBeforeRoute(nextRoute)) {
    return nextRoute;
  }

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
