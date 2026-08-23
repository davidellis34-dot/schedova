export type AuthenticatedAccountReadySource =
  | "local-session"
  | "previous-account-cleanup";

type PromoteAuthenticatedAccountToReadyInput = {
  previousUserId?: string | null;
  nextUserId: string;
  canApplyResult: () => boolean;
  canApplyBackgroundResult?: () => boolean;
  markAccountReady: (source: AuthenticatedAccountReadySource) => void;
  clearPreviousAccountWork?: () => Promise<void>;
  revalidateBusinessProfile?: () => Promise<boolean>;
  onBackgroundBusinessProfileRevalidationStarted?: () => void;
  onBackgroundBusinessProfileRevalidationFinished?: (
    hasBusinessProfile: boolean,
  ) => void;
  onBackgroundBusinessProfileRevalidationWarning?: (error: unknown) => void;
};

export async function promoteAuthenticatedAccountToReady(
  input: PromoteAuthenticatedAccountToReadyInput,
) {
  const canApplyBackgroundResult =
    input.canApplyBackgroundResult ?? input.canApplyResult;
  const requiresPreviousAccountCleanup = Boolean(
    input.previousUserId && input.previousUserId !== input.nextUserId,
  );

  if (requiresPreviousAccountCleanup) {
    await input.clearPreviousAccountWork?.();
  }

  if (!input.canApplyResult()) {
    return "stale" as const;
  }

  const readySource: AuthenticatedAccountReadySource =
    requiresPreviousAccountCleanup
      ? "previous-account-cleanup"
      : "local-session";
  input.markAccountReady(readySource);

  if (input.revalidateBusinessProfile) {
    input.onBackgroundBusinessProfileRevalidationStarted?.();

    void input
      .revalidateBusinessProfile()
      .then((hasBusinessProfile) => {
        if (!canApplyBackgroundResult()) {
          return;
        }

        input.onBackgroundBusinessProfileRevalidationFinished?.(
          hasBusinessProfile,
        );
      })
      .catch((error) => {
        if (!canApplyBackgroundResult()) {
          return;
        }

        input.onBackgroundBusinessProfileRevalidationWarning?.(error);
      });
  }

  return readySource;
}
