import type { AuthenticatedAppRoute } from "./authRouting";

// Any route other than Dashboard means the signed-in account still needs a
// required first-run decision before a task-specific deep link can open.
export function requiresInitialSetupGate(route: AuthenticatedAppRoute) {
  return route !== "/dashboard";
}
