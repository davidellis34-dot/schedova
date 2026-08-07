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

type LegacyAppointmentSmsBackfillInput = {
  smsNotificationsEnabled?: boolean | null;
  savedRecipientSmsEnabled?: boolean | null;
  hasExistingSmsActivity?: boolean;
  smsConfirmationSentAt?: string | null;
  smsReminderSentAt?: string | null;
  appointmentDate?: string | null;
  today?: string | null;
  clientPhone?: string | null;
  clientSmsOptIn?: boolean | null;
};

function cleanDateOnly(value: string | null | undefined) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function getTodayDateOnly() {
  return new Date().toISOString().slice(0, 10);
}

export function isAppointmentSmsEnabled(
  smsNotificationsEnabled: boolean | null | undefined,
) {
  return smsNotificationsEnabled === true;
}

export function shouldRunAppointmentSmsMutation({
  mutation: _mutation,
  smsAutomationAvailable = true,
  smsNotificationsEnabled,
}: AppointmentSmsMutationGateOptions) {
  if (!smsAutomationAvailable) {
    return false;
  }

  return isAppointmentSmsEnabled(smsNotificationsEnabled);
}

export function inferLegacyAppointmentSmsEnabled(
  input: LegacyAppointmentSmsBackfillInput,
) {
  if (typeof input.smsNotificationsEnabled === "boolean") {
    return input.smsNotificationsEnabled;
  }

  if (typeof input.savedRecipientSmsEnabled === "boolean") {
    return input.savedRecipientSmsEnabled;
  }

  if (
    input.hasExistingSmsActivity ||
    String(input.smsConfirmationSentAt || "").trim() ||
    String(input.smsReminderSentAt || "").trim()
  ) {
    return true;
  }

  const appointmentDate = cleanDateOnly(input.appointmentDate);
  const today = cleanDateOnly(input.today) || getTodayDateOnly();
  const hasClientPhone = Boolean(String(input.clientPhone || "").trim());
  const clientCanReceiveSms = hasClientPhone && input.clientSmsOptIn === true;

  if (appointmentDate && appointmentDate >= today && clientCanReceiveSms) {
    return true;
  }

  return false;
}
