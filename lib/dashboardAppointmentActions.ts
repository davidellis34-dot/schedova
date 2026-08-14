export type DashboardAppointmentActionId =
  | "edit"
  | "status"
  | "edit_client"
  | "delete";

const NARROW_DASHBOARD_ACTION_BREAKPOINT = 430;

export function getDashboardAppointmentActionRows(
  width: number,
): DashboardAppointmentActionId[][] {
  if (
    Number.isFinite(width) &&
    width > 0 &&
    width < NARROW_DASHBOARD_ACTION_BREAKPOINT
  ) {
    return [
      ["edit", "status"],
      ["edit_client", "delete"],
    ];
  }

  return [["edit", "edit_client", "status", "delete"]];
}
