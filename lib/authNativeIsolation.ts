import { Platform } from "react-native";

export const IOS_AUTH_NATIVE_ISOLATION = Platform.OS === "ios";

type DelayedAuthNativeSyncOptions = {
  userId: string;
  syncRevenueCat: () => Promise<void>;
  syncPush: () => Promise<void>;
};

let authNativeTransitionActive = IOS_AUTH_NATIVE_ISOLATION;
let authNativeTransitionUserId: string | null = null;
let authNativeTransitionRunId = 0;
let authNativeBypassDepth = 0;
let authNativeSyncQueue: Promise<void> = Promise.resolve();
let scheduledAuthNativeSyncKey: string | null = null;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function beginAuthNativeTransition(
  source: string,
  userId?: string | null,
) {
  if (!IOS_AUTH_NATIVE_ISOLATION) {
    return;
  }

  authNativeTransitionRunId += 1;
  authNativeTransitionActive = true;
  authNativeTransitionUserId = userId ?? null;
  scheduledAuthNativeSyncKey = null;

  console.log("[AuthNative] transition active", {
    source,
    userId: authNativeTransitionUserId,
    runId: authNativeTransitionRunId,
  });
}

export function shouldSkipAuthNativeWork(_userId?: string | null) {
  if (!IOS_AUTH_NATIVE_ISOLATION) {
    return false;
  }

  if (authNativeBypassDepth > 0) {
    return false;
  }

  return authNativeTransitionActive;
}

export async function withAuthNativeBypass<T>(operation: () => Promise<T>) {
  authNativeBypassDepth += 1;

  try {
    return await operation();
  } finally {
    authNativeBypassDepth = Math.max(0, authNativeBypassDepth - 1);
  }
}

export async function scheduleDelayedAuthNativeSync({
  userId,
  syncRevenueCat,
  syncPush,
}: DelayedAuthNativeSyncOptions) {
  if (!IOS_AUTH_NATIVE_ISOLATION || !userId) {
    return;
  }

  const runId = authNativeTransitionRunId;
  const syncKey = `${runId}:${userId}`;

  if (
    !authNativeTransitionActive ||
    authNativeTransitionUserId !== userId ||
    scheduledAuthNativeSyncKey === syncKey
  ) {
    return authNativeSyncQueue;
  }

  scheduledAuthNativeSyncKey = syncKey;

  authNativeSyncQueue = authNativeSyncQueue
    .catch(() => undefined)
    .then(async () => {
      if (
        !authNativeTransitionActive ||
        authNativeTransitionRunId !== runId ||
        authNativeTransitionUserId !== userId
      ) {
        return;
      }

      await delay(1000);

      if (
        !authNativeTransitionActive ||
        authNativeTransitionRunId !== runId ||
        authNativeTransitionUserId !== userId
      ) {
        return;
      }

      await withAuthNativeBypass(async () => {
        console.log("[AuthNative] delayed RevenueCat sync start", {
          userId,
        });

        try {
          await syncRevenueCat();
        } catch (error) {
          console.log("[AuthNative] delayed RevenueCat sync error", error);
        } finally {
          console.log("[AuthNative] delayed RevenueCat sync end", {
            userId,
          });
        }

        if (
          !authNativeTransitionActive ||
          authNativeTransitionRunId !== runId ||
          authNativeTransitionUserId !== userId
        ) {
          return;
        }

        console.log("[AuthNative] delayed push sync start", {
          userId,
        });

        try {
          await syncPush();
        } catch (error) {
          console.log("[AuthNative] delayed push sync error", error);
        } finally {
          console.log("[AuthNative] delayed push sync end", {
            userId,
          });
        }
      });

      if (
        authNativeTransitionRunId === runId &&
        authNativeTransitionUserId === userId
      ) {
        authNativeTransitionActive = false;
        scheduledAuthNativeSyncKey = null;

        console.log("[AuthNative] transition cleared", {
          source: "dashboard-delayed-sync",
          userId,
          runId,
        });
      }
    })
    .catch((error) => {
      console.log("[AuthNative] delayed native sync queue error", error);

      if (
        authNativeTransitionRunId === runId &&
        authNativeTransitionUserId === userId
      ) {
        authNativeTransitionActive = false;
        scheduledAuthNativeSyncKey = null;
      }
    });

  return authNativeSyncQueue;
}
