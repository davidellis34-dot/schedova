import type { Session } from "@supabase/supabase-js";

export type AuthDiagnosticEvent = {
  event: string;
  source: string;
  sessionExists: boolean;
  userId: string | null;
  email: string | null;
  at: string;
};

let lastAuthDiagnosticEvent: AuthDiagnosticEvent | null = null;

export function recordAuthDiagnosticEvent(
  event: string,
  session: Session | null,
  source: string,
) {
  lastAuthDiagnosticEvent = {
    event,
    source,
    sessionExists: Boolean(session),
    userId: session?.user?.id ?? null,
    email: session?.user?.email ?? null,
    at: new Date().toISOString(),
  };

  if (__DEV__) {
    console.log("[Auth] event", lastAuthDiagnosticEvent);
  }
}

export function getLastAuthDiagnosticEvent() {
  return lastAuthDiagnosticEvent;
}
