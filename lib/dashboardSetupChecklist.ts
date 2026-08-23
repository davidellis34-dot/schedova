import { countActiveClients } from "./freePlanLimits";

type DashboardSetupAppointment = {
  status?: string | null;
};

type DashboardSetupItem = {
  complete: boolean;
  label: string;
  route: string;
};

export function hasCompletedFirstAppointment(
  appointments: DashboardSetupAppointment[],
) {
  return appointments.some((appointment) => {
    const status = String(appointment?.status || "").trim().toLowerCase();
    return status !== "canceled" && status !== "cancelled";
  });
}

export function buildDashboardSetupChecklist(input: {
  hasBusiness: boolean | null;
  hasBusinessHours: boolean | null;
  hasReviewedSmsSettings: boolean | null;
  clients: Array<{ archived_at?: string | null }>;
  appointments: DashboardSetupAppointment[];
  services: Array<{ id?: string | null }>;
  firstBookingEntryRoute: string;
}): DashboardSetupItem[] {
  return [
    {
      complete: input.hasBusiness === true,
      label: "Business profile completed",
      route: "/business-setup",
    },
    {
      complete: input.services.length > 0,
      label: "First service added",
      route: "/add-service",
    },
    {
      complete: countActiveClients(input.clients) > 0,
      label: "First client added",
      route: "/clients",
    },
    {
      complete: hasCompletedFirstAppointment(input.appointments),
      label: "First appointment booked",
      route: input.firstBookingEntryRoute,
    },
    {
      complete: input.hasReviewedSmsSettings === true,
      label: "SMS settings reviewed",
      route: "/settings/sms",
    },
    {
      complete: input.hasBusinessHours === true,
      label: "Business hours configured",
      route: "/availability-settings",
    },
  ];
}
