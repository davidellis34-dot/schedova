import { hasSelectedUserCountryRegion } from "./countrySettings";
import { hasCompletedOnboarding } from "./onboarding";

export type AuthenticatedAppRoute =
  | "/dashboard"
  | "/onboarding"
  | {
      pathname: "/country-region";
      params: { next: "/dashboard" | "/onboarding" };
    };

export async function resolveAuthenticatedAppRoute(): Promise<AuthenticatedAppRoute> {
  const nextRoute = (await hasCompletedOnboarding()
    ? "/dashboard"
    : "/onboarding") as "/dashboard" | "/onboarding";

  if (!(await hasSelectedUserCountryRegion())) {
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
