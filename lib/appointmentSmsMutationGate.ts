export type AppointmentSmsMutationType =
  | "create"
  | "update"
  | "cancellation"
  | "deletion";

type AppointmentSmsMutationGateOptions = {
  mutation: AppointmentSmsMutationType;
  smsAutomationAvailable?: boolean;
  smsNotificationsEnabled?: boolean | null;
};

export function shouldRunAppointmentSmsMutation({
  mutation,
  smsAutomationAvailable = true,
  smsNotificationsEnabled,
}: AppointmentSmsMutationGateOptions) {
  if (!smsAutomationAvailable) {
    return false;
  }

  switch (mutation) {
    case "create":
    case "update":
      return smsNotificationsEnabled === true;
    case "cancellation":
    case "deletion":
      return smsNotificationsEnabled !== false;
    default:
      return false;
  }
}
