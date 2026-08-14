import type { AuthenticatedAppRoute } from "./authRouting";

// Any route other than Dashboard means the signed-in account still needs a
// required first-run decision before a task-specific deep link can open.
export function requiresInitialSetupGate(route: AuthenticatedAppRoute) {
  return route !== "/dashboard";
}

export const ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW =
  "onboarding-booking" as const;

export function canStayOnInitialSetupChildRoute(input: {
  currentPathname: string;
  hasExplicitAccess: boolean;
  returnTo: string | null;
  setupFlow: string | null;
  unresolvedSetupRoute: AuthenticatedAppRoute;
}) {
  if (input.unresolvedSetupRoute !== "/onboarding") {
    return false;
  }

  return (
    input.currentPathname === "/book-appointment" &&
    input.returnTo === "/onboarding" &&
    input.setupFlow === ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW &&
    input.hasExplicitAccess
  );
}
