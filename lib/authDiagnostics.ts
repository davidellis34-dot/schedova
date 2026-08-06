import type { Session } from "@supabase/supabase-js";

export type AuthDiagnosticEvent = {
  event: string;
  source: string;
  sessionExists: boolean;
  userIdPresent: boolean;
  emailPresent: boolean;
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
    userIdPresent: Boolean(session?.user?.id),
    emailPresent: Boolean(session?.user?.email),
    at: new Date().toISOString(),
  };

  if (__DEV__) {
    console.log("[Auth] event", lastAuthDiagnosticEvent);
  }
}

export function getLastAuthDiagnosticEvent() {
  return lastAuthDiagnosticEvent;
}
