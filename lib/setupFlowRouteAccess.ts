import { ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW } from "./initialSetupRouting";

type SetupFlowRoutePath = "/book-appointment";

type PendingSetupFlowRouteAccess = {
  pathname: SetupFlowRoutePath;
  returnTo: "/onboarding";
  setupFlow: typeof ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW;
};

const pendingSetupFlowRouteAccessByUserId = new Map<
  string,
  PendingSetupFlowRouteAccess
>();

export function allowSetupFlowRouteAccess(input: {
  pathname: SetupFlowRoutePath;
  returnTo: "/onboarding";
  setupFlow: typeof ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW;
  userId?: string | null;
}) {
  const userId = String(input.userId || "").trim();
  if (!userId) return;

  pendingSetupFlowRouteAccessByUserId.set(userId, {
    pathname: input.pathname,
    returnTo: input.returnTo,
    setupFlow: input.setupFlow,
  });
}

export function hasSetupFlowRouteAccess(input: {
  pathname: SetupFlowRoutePath;
  returnTo: "/onboarding";
  setupFlow: typeof ONBOARDING_BOOK_APPOINTMENT_SETUP_FLOW;
  userId?: string | null;
}) {
  const userId = String(input.userId || "").trim();
  if (!userId) return false;

  const pendingAccess = pendingSetupFlowRouteAccessByUserId.get(userId);
  if (!pendingAccess) return false;

  return (
    pendingAccess.pathname === input.pathname &&
    pendingAccess.returnTo === input.returnTo &&
    pendingAccess.setupFlow === input.setupFlow
  );
}

export function revokeSetupFlowRouteAccess(userId?: string | null) {
  const safeUserId = String(userId || "").trim();
  if (!safeUserId) return;

  pendingSetupFlowRouteAccessByUserId.delete(safeUserId);
}

export function resetSetupFlowRouteAccessForTests() {
  pendingSetupFlowRouteAccessByUserId.clear();
}
