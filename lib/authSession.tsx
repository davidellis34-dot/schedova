import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { recordAuthDiagnosticEvent } from "./authDiagnostics";
import { supabase } from "./supabase";

type AuthSessionContextValue = {
  isHydrated: boolean;
  session: Session | null;
  user: User | null;
  userId: string | null;
  userEmail: string | null;
};

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [isHydrated, setIsHydrated] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

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

      setSession(data.session ?? null);
      setIsHydrated(true);
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

        setSession(nextSession ?? null);
        setIsHydrated(true);
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
      authListener.subscription.unsubscribe();
      appStateListener.remove();
      supabase.auth.stopAutoRefresh();
    };
  }, []);

  const value = useMemo<AuthSessionContextValue>(
    () => ({
      isHydrated,
      session,
      user: session?.user ?? null,
      userId: session?.user?.id ?? null,
      userEmail: session?.user?.email ?? null,
    }),
    [isHydrated, session],
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
