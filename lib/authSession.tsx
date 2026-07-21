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
  const sessionVerificationRunIdRef = useRef(0);
  const authEventVersionRef = useRef(0);

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

  const applySession = useCallback(
    (nextSession: Session | null, source: string) => {
      const nextUserId = nextSession?.user?.id ?? null;
      const previousUserId = latestSessionUserIdRef.current;
      const hasAuthenticatedUser = Boolean(nextSession && nextUserId);

      latestSessionUserIdRef.current = nextUserId;
      setSession(nextSession);
      setIsHydrated(true);
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
        resolvePendingSignOuts();
        return;
      }

      const transition = continueAccountTransition(source, nextUserId);
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

      // Both the Supabase user and account-scoped business profile must settle
      // before the authenticated navigator can mount for this account.
      void (async () => {
        try {
          const { data, error } = await supabase.auth.getUser();

          if (
            verificationRunId !== sessionVerificationRunIdRef.current ||
            latestSessionUserIdRef.current !== nextUserId ||
            !isCurrentAccountTransition(transition.runId)
          ) {
            recordAccountTransitionEvent("previous-async-result-ignored", {
              source: `${source}:get-user`,
              userId: nextUserId,
            });
            return;
          }

          if (error || data.user?.id !== nextUserId) {
            recordAccountTransitionEvent("supabase-session-verification-warning", {
              error: error?.message || null,
              expectedUserId: nextUserId,
              returnedUserId: data.user?.id || null,
              source,
            });
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
          accountReadyUserIdRef.current = nextUserId;
          setAccountReadyUserId(nextUserId);
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
    [resolvePendingSignOuts],
  );

  const beginSignInTransition = useCallback(() => {
    recordAccountTransitionEvent("sign-in-started");
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
            userId: data.session?.user?.id || null,
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
            userId: nextSession?.user?.id || null,
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
    setAuthTransitionState("signingOut");

    const signOutPromise = (async () => {
      try {
        recordAccountTransitionEvent("supabase-sign-out-started", {
          userId: currentUserId ?? null,
        }, transition.runId);
        await cancelAccountScopedWork("auth-session-sign-out", transition.runId);
        clearFeatureAccess("auth:signing-out");
        recordAccountTransitionEvent("old-account-state-cleared", {
          userId: currentUserId ?? null,
        }, transition.runId);

        setRevenueCatIdentityTarget(null);
        await logOutRevenueCatUser();

        const { error } = await supabase.auth.signOut();

        if (error) {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null, "sign-out-error");
          resolvePendingSignOuts();
          completeAccountTransition(transition.runId, "sign-out-error");
          return { error };
        }

        await waitForSignedOutConfirmation();
        recordAccountTransitionEvent("supabase-sign-out-completed", {}, transition.runId);
        return { error: null };
      } catch (error) {
        try {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null, "sign-out-exception");
        } catch {
          applySession(null, "sign-out-exception-fallback");
        }
        resolvePendingSignOuts();
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
