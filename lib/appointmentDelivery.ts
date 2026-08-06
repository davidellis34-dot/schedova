import type { CommunicationRecipient } from "./communicationRecipients";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const SMS_DELIVERY_WARNING = "Text needs a phone number and SMS opt-in.";
export const EMAIL_DELIVERY_WARNING =
  "Email needs an email address and email opt-in.";

type AppointmentDeliveryFlags = {
  smsEnabled: boolean;
  emailEnabled: boolean;
};

export type AppointmentDeliveryChoice = "text" | "email" | "both" | "none";

const APPOINTMENT_DELIVERY_FALLBACKS: Record<
  AppointmentDeliveryChoice,
  AppointmentDeliveryChoice[]
> = {
  text: ["text", "email", "none"],
  email: ["email", "text", "none"],
  both: ["both", "text", "email", "none"],
  none: ["none", "text", "email", "both"],
};

type AppointmentDeliveryValidationInput = {
  deliveryChoice: AppointmentDeliveryChoice;
  recipients: CommunicationRecipient[];
};

type PhoneNormalizer = (value: string) => Promise<string> | string;

export type AppointmentDeliveryValidation = AppointmentDeliveryFlags & {
  deliveryChoice: AppointmentDeliveryChoice;
  recipients: CommunicationRecipient[];
  smsRecipientCount: number;
  emailRecipientCount: number;
  smsIssue: string;
  emailIssue: string;
  issues: string[];
};

function cleanEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function isValidAppointmentEmail(value: string | null | undefined) {
  const email = cleanEmail(value);
  return Boolean(email) && EMAIL_PATTERN.test(email);
}

export function getAppointmentDeliveryFlags(
  deliveryChoice: AppointmentDeliveryChoice,
): AppointmentDeliveryFlags {
  return {
    smsEnabled: deliveryChoice === "text" || deliveryChoice === "both",
    emailEnabled: deliveryChoice === "email" || deliveryChoice === "both",
  };
}

export function getAppointmentDeliveryChoiceFromFlags(input: {
  smsEnabled?: boolean | null;
  emailEnabled?: boolean | null;
  fallbackChoice?: AppointmentDeliveryChoice;
}): AppointmentDeliveryChoice {
  const hasSmsFlag = typeof input.smsEnabled === "boolean";
  const hasEmailFlag = typeof input.emailEnabled === "boolean";

  if (!hasSmsFlag && !hasEmailFlag) {
    return input.fallbackChoice || "none";
  }

  const smsEnabled = Boolean(input.smsEnabled);
  const emailEnabled = Boolean(input.emailEnabled);

  if (smsEnabled && emailEnabled) return "both";
  if (smsEnabled) return "text";
  if (emailEnabled) return "email";
  return "none";
}

export function getAvailableAppointmentDeliveryChoice(input: {
  recipients: CommunicationRecipient[];
  preferredChoice?: AppointmentDeliveryChoice | null;
  fallbackChoice?: AppointmentDeliveryChoice | null;
}): AppointmentDeliveryChoice {
  const baseChoice =
    input.preferredChoice || input.fallbackChoice || "none";
  const candidates: AppointmentDeliveryChoice[] = [];
  const seenChoices = new Set<AppointmentDeliveryChoice>();

  function addCandidate(choice?: AppointmentDeliveryChoice | null) {
    if (!choice || seenChoices.has(choice)) return;
    seenChoices.add(choice);
    candidates.push(choice);
  }

  addCandidate(input.preferredChoice);
  addCandidate(input.fallbackChoice);

  for (const choice of APPOINTMENT_DELIVERY_FALLBACKS[baseChoice]) {
    addCandidate(choice);
  }

  for (const choice of APPOINTMENT_DELIVERY_FALLBACKS.none) {
    addCandidate(choice);
  }

  return (
    candidates.find(
      (deliveryChoice) =>
        getAppointmentDeliveryPreview({
          deliveryChoice,
          recipients: input.recipients,
        }).issues.length === 0,
    ) || "none"
  );
}

export function applyDeliveryChoiceToRecipients(
  recipients: CommunicationRecipient[],
  deliveryChoice: AppointmentDeliveryChoice,
) {
  const { smsEnabled, emailEnabled } =
    getAppointmentDeliveryFlags(deliveryChoice);

  return (Array.isArray(recipients) ? recipients : []).map((recipient) => ({
    ...recipient,
    name: String(recipient?.name || "").trim(),
    relationship: String(recipient?.relationship || "").trim(),
    phone: String(recipient?.phone || "").trim(),
    email: cleanEmail(recipient?.email || ""),
    smsEnabled: smsEnabled ? Boolean(recipient?.smsEnabled) : false,
    emailEnabled: emailEnabled ? Boolean(recipient?.emailEnabled) : false,
  }));
}

export function getAppointmentDeliveryPreview(
  input: AppointmentDeliveryValidationInput,
): AppointmentDeliveryValidation {
  const recipients = applyDeliveryChoiceToRecipients(
    input.recipients,
    input.deliveryChoice,
  );
  const { smsEnabled, emailEnabled } = getAppointmentDeliveryFlags(
    input.deliveryChoice,
  );
  const smsRecipientCount = smsEnabled
    ? recipients.filter(
        (recipient) =>
          recipient.smsEnabled && String(recipient.phone || "").trim(),
      ).length
    : 0;
  const emailRecipientCount = emailEnabled
    ? recipients.filter(
        (recipient) =>
          recipient.emailEnabled && isValidAppointmentEmail(recipient.email),
      ).length
    : 0;
  const smsIssue =
    smsEnabled && smsRecipientCount === 0 ? SMS_DELIVERY_WARNING : "";
  const emailIssue =
    emailEnabled && emailRecipientCount === 0 ? EMAIL_DELIVERY_WARNING : "";
  const issues = [smsIssue, emailIssue].filter(Boolean);

  return {
    deliveryChoice: input.deliveryChoice,
    smsEnabled,
    emailEnabled,
    recipients,
    smsRecipientCount,
    emailRecipientCount,
    smsIssue,
    emailIssue,
    issues,
  };
}

export async function resolveAppointmentDeliveryValidation(
  input: AppointmentDeliveryValidationInput & {
    normalizePhone?: PhoneNormalizer;
  },
): Promise<AppointmentDeliveryValidation> {
  const { deliveryChoice } = input;
  const recipients = applyDeliveryChoiceToRecipients(
    input.recipients,
    deliveryChoice,
  );
  const { smsEnabled, emailEnabled } = getAppointmentDeliveryFlags(
    deliveryChoice,
  );
  const normalizePhone =
    input.normalizePhone ||
    ((value: string) => String(value || "").trim());

  const normalizedRecipients = await Promise.all(
    recipients.map(async (recipient) => {
      const normalizedPhone = recipient.phone
        ? String((await normalizePhone(recipient.phone)) || "").trim()
        : "";

      return {
        ...recipient,
        phone: normalizedPhone || recipient.phone,
        hasValidSmsPhone: Boolean(normalizedPhone),
      };
    }),
  );

  const smsRecipientCount = smsEnabled
    ? normalizedRecipients.filter(
        (recipient) => recipient.smsEnabled && recipient.hasValidSmsPhone,
      ).length
    : 0;
  const emailRecipientCount = emailEnabled
    ? normalizedRecipients.filter(
        (recipient) =>
          recipient.emailEnabled && isValidAppointmentEmail(recipient.email),
      ).length
    : 0;
  const smsIssue =
    smsEnabled && smsRecipientCount === 0 ? SMS_DELIVERY_WARNING : "";
  const emailIssue =
    emailEnabled && emailRecipientCount === 0 ? EMAIL_DELIVERY_WARNING : "";
  const issues = [smsIssue, emailIssue].filter(Boolean);

  return {
    deliveryChoice,
    smsEnabled,
    emailEnabled,
    recipients: normalizedRecipients.map(
      ({ hasValidSmsPhone: _ignored, ...recipient }) => recipient,
    ),
    smsRecipientCount,
    emailRecipientCount,
    smsIssue,
    emailIssue,
    issues,
  };
}
