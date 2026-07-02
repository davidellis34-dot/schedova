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
import { recordAuthDiagnosticEvent } from "./authDiagnostics";
import { clearFeatureAccess } from "./featureAccess";
import { supabase } from "./supabase";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "signingOut";

type AuthSessionContextValue = {
  isHydrated: boolean;
  authStatus: AuthStatus;
  isAuthenticated: boolean;
  isAuthTransitioning: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
  userEmail: string | null;
  signOut: () => Promise<{ error: Error | null }>;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const signOutPromiseRef = useRef<Promise<{ error: Error | null }> | null>(
    null,
  );
  const signOutWaitersRef = useRef<Array<() => void>>([]);

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
    (nextSession: Session | null) => {
      setSession(nextSession);
      setIsHydrated(true);
      setAuthStatus(nextSession ? "authenticated" : "unauthenticated");

      if (!nextSession) {
        resolvePendingSignOuts();
      }
    },
    [resolvePendingSignOuts],
  );

  useEffect(() => {
    let mounted = true;

    supabase.auth.startAutoRefresh();

    async function loadInitialSession() {
      const { data, error } = await supabase.auth.getSession();

      if (!mounted) return;

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

      applySession(data.session ?? null);
    }

    void loadInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!mounted) return;

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

        applySession(nextSession ?? null);
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

    setAuthStatus((current) =>
      current === "unauthenticated" ? current : "signingOut",
    );
    clearFeatureAccess("auth:signing-out");

    const signOutPromise = (async () => {
      try {
        const { error } = await supabase.auth.signOut();

        if (error) {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null);
          resolvePendingSignOuts();
          return { error };
        }

        await waitForSignedOutConfirmation();
        return { error: null };
      } catch (error) {
        try {
          const { data } = await supabase.auth.getSession();
          applySession(data.session ?? null);
        } catch {
          applySession(null);
        }
        resolvePendingSignOuts();

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

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      authStatus,
      isAuthenticated: authStatus === "authenticated",
      isAuthTransitioning: authStatus === "signingOut",
      session: exposedSession,
      user: exposedSession?.user ?? null,
      userId: exposedSession?.user?.id ?? null,
      userEmail: exposedSession?.user?.email ?? null,
      signOut,
    }),
    [authStatus, exposedSession, isHydrated, signOut],
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
