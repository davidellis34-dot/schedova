import type { Session, User } from "@supabase/supabase-js";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import {
  beginAccountTransition,
  cancelAccountScopedWork,
  completeAccountTransition,
  continueAccountTransition,
  isCurrentAccountTransition,
  recordAccountTransitionEvent,
} from "./accountTransition";
import { recordAuthDiagnosticEvent } from "./authDiagnostics";
import { clearCalendarFinderCache } from "./calendarFinderCache";
import { clearDashboardPrimaryCache } from "./dashboardCache";
import { clearFeatureAccess } from "./featureAccess";
import {
  logOutRevenueCatUser,
  setRevenueCatIdentityTarget,
} from "./revenuecat/revenueCatService";
import { supabase } from "./supabase";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "signingOut";

type AuthTransitionState = "idle" | "signingIn" | "signingOut";

type AuthSessionContextValue = {
  isHydrated: boolean;
  isAccountReady: boolean;
  authStatus: AuthStatus;
  authTransitionState: AuthTransitionState;
  isAuthenticated: boolean;
  isAuthTransitioning: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
  userEmail: string | null;
  beginSignInTransition: () => void;
  cancelAuthTransition: () => void;
  signOut: () => Promise<{ error: Error | null }>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [authTransitionState, setAuthTransitionState] =
    useState<AuthTransitionState>("idle");
  const [accountReadyUserId, setAccountReadyUserId] = useState<string | null>(
    null,
  );
  const signOutPromiseRef = useRef<Promise<{ error: Error | null }> | null>(
    null,
  );
  const signOutWaitersRef = useRef<Array<() => void>>([]);
  const latestSessionUserIdRef = useRef<string | null>(null);
  const accountReadyUserIdRef = useRef<string | null>(null);
  const lastClearedAccountUserIdRef = useRef<string | null>(null);
  const sessionVerificationRunIdRef = useRef(0);
  const authEventVersionRef = useRef(0);
  const authStatusRef = useRef<AuthStatus>("loading");
  const initialSessionAppliedRef = useRef(false);

  const resolvePendingSignOuts = useCallback(() => {
    const waiters = [...signOutWaitersRef.current];
    signOutWaitersRef.current = [];
    waiters.forEach((resolve) => resolve());
  }, []);

  const waitForSignedOutConfirmation = useCallback(async () => {
    await new Promise<void>((resolve) => {
      let resolved = false;
      const timeoutId = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        resolve();
      }, 5_000);

      signOutWaitersRef.current.push(() => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutId);
        resolve();
      });
    });
  }, []);

  const clearAccountScopedWorkOnce = useCallback(
    async (accountId: string | null, source: string, runId: number) => {
      if (!accountId || lastClearedAccountUserIdRef.current === accountId) {
        return;
      }

      lastClearedAccountUserIdRef.current = accountId;
      clearDashboardPrimaryCache(accountId);
      clearCalendarFinderCache(accountId);
      recordAccountTransitionEvent("account_caches_cleared", { source }, runId);
      recordAccountTransitionEvent("query_cache_cleared", {}, runId);
      await cancelAccountScopedWork(source, runId);
    },
    [],
  );

  const applySession = useCallback(
    (nextSession: Session | null, source: string) => {
      const nextUserId = nextSession?.user?.id ?? null;
      const previousUserId = latestSessionUserIdRef.current;
      const hasAuthenticatedUser = Boolean(nextSession && nextUserId);
      const isInitialSessionSource =
        source === "initial-session" || source === "auth-callback:INITIAL_SESSION";

      // Supabase emits INITIAL_SESSION in addition to our initial getSession()
      // hydration. Let whichever result arrives first own the bootstrap so the
      // second one cannot cancel it while account readiness is being resolved.
      if (
        source === "auth-callback:INITIAL_SESSION" &&
        initialSessionAppliedRef.current
      ) {
        recordAccountTransitionEvent("duplicate_initial_session_ignored", {
          source,
        });
        return;
      }

      if (isInitialSessionSource) {
        initialSessionAppliedRef.current = true;
      }

      // Supabase can emit a second SIGNED_OUT event after global sign-out. The
      // serialized sign-out path already cleared the old account, so ignore
      // that duplicate rather than invalidating a newly arriving session.
      if (
        !nextUserId &&
        !previousUserId &&
        authStatusRef.current === "unauthenticated"
      ) {
        recordAccountTransitionEvent("duplicate_signed_out_ignored", { source });
        resolvePendingSignOuts();
        return;
      }

      latestSessionUserIdRef.current = nextUserId;
      setSession(nextSession);
      setIsHydrated(true);
      authStatusRef.current = hasAuthenticatedUser
        ? "authenticated"
        : "unauthenticated";
      setAuthStatus(
        hasAuthenticatedUser ? "authenticated" : "unauthenticated",
      );
      setAuthTransitionState("idle");

      if (!nextSession || !nextUserId) {
        setRevenueCatIdentityTarget(null);
        sessionVerificationRunIdRef.current += 1;
        accountReadyUserIdRef.current = null;
        setAccountReadyUserId(null);
        recordAccountTransitionEvent("old-account-state-cleared", {
          previousUserId,
          source,
        });
        void clearAccountScopedWorkOnce(previousUserId, `${source}:signed-out`, 0).catch((error) => {
          recordAccountTransitionEvent("account_switch_failed", {
            source: `${source}:cleanup`,
            error: error instanceof Error ? error.message : String(error),
          });
        });
        resolvePendingSignOuts();
        return;
      }

      const transition = continueAccountTransition(source, nextUserId);
      recordAccountTransitionEvent(
        "supabase_session_received",
        { source },
        transition.runId,
      );
      // A newly authenticated account needs its own cleanup lifecycle later.
      lastClearedAccountUserIdRef.current = null;
      setRevenueCatIdentityTarget(nextUserId);

      if (
        previousUserId === nextUserId &&
        accountReadyUserIdRef.current === nextUserId
      ) {
        recordAccountTransitionEvent("new-profile-reused", {
          userId: nextUserId,
        });
        completeAccountTransition(transition.runId, `${source}:profile-reused`);
        return;
      }

      const verificationRunId = sessionVerificationRunIdRef.current + 1;
      sessionVerificationRunIdRef.current = verificationRunId;
      accountReadyUserIdRef.current = null;
      setAccountReadyUserId(null);
      recordAccountTransitionEvent(
        "user_bootstrap_started",
        { source },
        transition.runId,
      );

      // Both the Supabase user and account-scoped business profile must settle
      // before the authenticated navigator can mount for this account.
      void (async () => {
        try {
          if (previousUserId && previousUserId !== nextUserId) {
            await clearAccountScopedWorkOnce(
              previousUserId,
              `${source}:account-changed`,
              transition.runId,
            );

            if (
              verificationRunId !== sessionVerificationRunIdRef.current ||
              latestSessionUserIdRef.current !== nextUserId ||
              !isCurrentAccountTransition(transition.runId)
            ) {
              recordAccountTransitionEvent("previous-async-result-ignored", {
                source: `${source}:account-cleanup`,
                userId: nextUserId,
              });
              return;
            }
          }

          const { data: profileRows, error: profileError } = await supabase
            .from("businesses")
            .select("id")
            .eq("user_id", nextUserId)
            .limit(1);

          if (
            verificationRunId !== sessionVerificationRunIdRef.current ||
            latestSessionUserIdRef.current !== nextUserId ||
            !isCurrentAccountTransition(transition.runId)
          ) {
            recordAccountTransitionEvent("previous-async-result-ignored", {
              source: `${source}:business-profile`,
              userId: nextUserId,
            });
            return;
          }

          recordAccountTransitionEvent("new-profile-loaded", {
            hasBusinessProfile: Array.isArray(profileRows) && profileRows.length > 0,
            profileError: profileError?.message || null,
            userId: nextUserId,
          });
          recordAccountTransitionEvent("new_user_data_loaded", {
            hasBusinessProfile: Array.isArray(profileRows) && profileRows.length > 0,
            profileError: profileError?.message || null,
            userId: nextUserId,
          });
          accountReadyUserIdRef.current = nextUserId;
          setAccountReadyUserId(nextUserId);
          recordAccountTransitionEvent(
            "user_bootstrap_finished",
            {},
            transition.runId,
          );
          completeAccountTransition(transition.runId, `${source}:profile-ready`);
        } catch (error) {
          if (
            verificationRunId === sessionVerificationRunIdRef.current &&
            latestSessionUserIdRef.current === nextUserId &&
            isCurrentAccountTransition(transition.runId)
          ) {
            recordAccountTransitionEvent("new-profile-load-warning", {
              error: error instanceof Error ? error.message : String(error),
              userId: nextUserId,
            });
            accountReadyUserIdRef.current = nextUserId;
            setAccountReadyUserId(nextUserId);
            recordAccountTransitionEvent(
              "user_bootstrap_finished",
              { outcome: "profile-warning" },
              transition.runId,
            );
            completeAccountTransition(transition.runId, `${source}:profile-error`);
            return;
          }

          recordAccountTransitionEvent("previous-async-result-ignored", {
            source: `${source}:profile-error`,
            userId: nextUserId,
          });
        }
      })();
    },
    [clearAccountScopedWorkOnce, resolvePendingSignOuts],
  );

  const beginSignInTransition = useCallback(() => {
    recordAccountTransitionEvent("sign_in_started");
    setAuthTransitionState((current) =>
      current === "signingOut" ? current : "signingIn",
    );
  }, []);

  const cancelAuthTransition = useCallback(() => {
    setAuthTransitionState((current) =>
      current === "signingOut" ? current : "idle",
    );
  }, []);

  useEffect(() => {
    let mounted = true;

    supabase.auth.startAutoRefresh();

    async function loadInitialSession() {
      try {
        const authEventVersionAtStart = authEventVersionRef.current;
        const { data, error } = await supabase.auth.getSession();

        if (!mounted || authEventVersionAtStart !== authEventVersionRef.current) {
          return;
        }

        if (__DEV__) {
          console.log("[AuthSession] initial session loaded", {
            hasSession: Boolean(data.session),
            error: error?.message || null,
          });
        }

        recordAuthDiagnosticEvent(
          "APP_START_SESSION",
          data.session,
          "AuthSessionProvider.getSession",
        );

        applySession(data.session ?? null, "initial-session");
      } catch (error) {
        if (!mounted) return;

        recordAccountTransitionEvent("initial-session-load-warning", {
          error: error instanceof Error ? error.message : String(error),
        });
        applySession(null, "initial-session-error");
      }
    }

    void loadInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mounted) return;

        authEventVersionRef.current += 1;

        if (__DEV__) {
          console.log("[AuthSession] auth state changed", {
            event,
            hasSession: Boolean(nextSession),
          });
        }

        recordAuthDiagnosticEvent(
          event,
          nextSession,
          "AuthSessionProvider.onAuthStateChange",
        );

        recordAccountTransitionEvent("supabase-auth-state-callback-fired", {
          event,
          userId: nextSession?.user?.id || null,
        });
        applySession(nextSession ?? null, `auth-callback:${event}`);
      },
    );

    const appStateListener = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        supabase.auth.startAutoRefresh();
        return;
      }

      supabase.auth.stopAutoRefresh();
    });

    return () => {
      mounted = false;
      resolvePendingSignOuts();
      authListener.subscription.unsubscribe();
      appStateListener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, [applySession, resolvePendingSignOuts]);

  const signOut = useCallback(async () => {
    if (signOutPromiseRef.current) {
      return signOutPromiseRef.current;
    }

    if (authStatus === "unauthenticated" && !session) {
      clearFeatureAccess("auth:sign-out-no-session");
      return { error: null };
    }

    const currentUserId = session?.user?.id ?? latestSessionUserIdRef.current;
    recordAccountTransitionEvent("sign_out_pressed");
    const transition = beginAccountTransition(
      "auth-session-sign-out",
      currentUserId,
    );
    if (!transition.accepted) {
      return { error: null };
    }

    setAuthStatus((current) =>
      current === "unauthenticated" ? current : "signingOut",
    );
    authStatusRef.current = "signingOut";
    setAuthTransitionState("signingOut");

    const signOutPromise = (async () => {
      try {
        recordAccountTransitionEvent("revenuecat_logout_started", {}, transition.runId);
        try {
          await logOutRevenueCatUser();
        } catch (revenueCatError) {
          recordAccountTransitionEvent("revenuecat_logout_failed", {
            error:
              revenueCatError instanceof Error
                ? revenueCatError.message
                : String(revenueCatError),
          }, transition.runId);
        } finally {
          recordAccountTransitionEvent("revenuecat_logout_finished", {}, transition.runId);
        }

        await clearAccountScopedWorkOnce(
          currentUserId,
          "auth-session-sign-out",
          transition.runId,
        );
        clearFeatureAccess("auth:signing-out");
        recordAccountTransitionEvent("old-account-state-cleared", {
          userId: currentUserId ?? null,
        }, transition.runId);

        setRevenueCatIdentityTarget(null);
        recordAccountTransitionEvent("supabase_signout_started", {}, transition.runId);
        const { error } = await supabase.auth.signOut();

        if (error) {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null, "sign-out-error");
          resolvePendingSignOuts();
          completeAccountTransition(transition.runId, "sign-out-error");
          return { error };
        }

        await waitForSignedOutConfirmation();
        recordAccountTransitionEvent("supabase_signout_finished", {}, transition.runId);
        return { error: null };
      } catch (error) {
        try {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null, "sign-out-exception");
        } catch {
          applySession(null, "sign-out-exception-fallback");
        }
        resolvePendingSignOuts();
        recordAccountTransitionEvent("account_switch_failed", {
          source: "auth-session-sign-out",
          error: error instanceof Error ? error.message : String(error),
        }, transition.runId);
        completeAccountTransition(transition.runId, "sign-out-exception");

        return {
          error:
            error instanceof Error
              ? error
              : new Error("Unable to sign out."),
        };
      } finally {
        signOutPromiseRef.current = null;
      }
    })();

    signOutPromiseRef.current = signOutPromise;
    return signOutPromise;
  }, [
    applySession,
    authStatus,
    clearAccountScopedWorkOnce,
    resolvePendingSignOuts,
    session,
    waitForSignedOutConfirmation,
  ]);

  const exposedSession =
    authStatus === "authenticated" ? session ?? null : null;
  const isAccountReady =
    authStatus === "authenticated" &&
    Boolean(exposedSession?.user?.id) &&
    accountReadyUserId === exposedSession?.user?.id;

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      isAccountReady,
      authStatus,
      authTransitionState,
      isAuthenticated: authStatus === "authenticated",
      isAuthTransitioning:
        authStatus === "loading" || authTransitionState !== "idle",
      session: exposedSession,
      user: exposedSession?.user ?? null,
      userId: exposedSession?.user?.id ?? null,
      userEmail: exposedSession?.user?.email ?? null,
      beginSignInTransition,
      cancelAuthTransition,
      signOut,
    }),
    [
      authStatus,
      authTransitionState,
      beginSignInTransition,
      cancelAuthTransition,
      exposedSession,
      isHydrated,
      isAccountReady,
      signOut,
    ],
  );

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);

  if (!context) {
    throw new Error("useAuthSession must be used inside AuthSessionProvider.");
  }

  return context;
}
