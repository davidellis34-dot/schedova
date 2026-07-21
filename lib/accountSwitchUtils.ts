export function shouldApplyAccountScopedResult({
  requestUserId,
  currentUserId,
  requestId,
  currentRequestId,
}: {
  requestUserId: string | null | undefined;
  currentUserId: string | null | undefined;
  requestId: number;
  currentRequestId: number;
}) {
  return (
    Boolean(requestUserId) &&
    requestUserId === currentUserId &&
    requestId === currentRequestId
  );
}

export function shouldStartRevenueCatIdentitySync({
  targetUserId,
  activeUserId,
  inFlightUserId,
}: {
  targetUserId: string | null | undefined;
  activeUserId: string | null | undefined;
  inFlightUserId: string | null | undefined;
}) {
  return Boolean(targetUserId) && targetUserId === activeUserId && inFlightUserId !== targetUserId;
}

export type BusinessSetupScreenState = "loading" | "editing" | "error";

export function resolveBusinessSetupScreenState({
  isHydrated,
  isAccountReady,
  userId,
  loadedUserId,
  error,
}: {
  isHydrated: boolean;
  isAccountReady: boolean;
  userId: string | null | undefined;
  loadedUserId: string | null | undefined;
  error: string | null | undefined;
}): BusinessSetupScreenState {
  if (!isHydrated || !isAccountReady || !userId || loadedUserId !== userId) {
    return "loading";
  }

  return error ? "error" : "editing";
}

export function shouldStartBusinessSetupSave({
  hasInFlightSave,
  isSaving,
  screenState,
}: {
  hasInFlightSave: boolean;
  isSaving: boolean;
  screenState: BusinessSetupScreenState;
}) {
  return !hasInFlightSave && !isSaving && screenState !== "loading";
}
