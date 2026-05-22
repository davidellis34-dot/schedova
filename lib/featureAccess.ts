export const FREE_TIER_LIMITS = {
  clients: 25,
  services: 5,
  appointmentsPerMonth: 30,
  messageTemplates: 3,
  clientHistoryItems: 3,
} as const;

export const PRO_FEATURE_PREVIEWS = [
  "Automatic SMS reminders and confirmations",
  "Smart rebooking and follow-up reminders",
  "Revenue dashboard / business insights",
  "Advanced client history timeline",
  "Client photo gallery",
  "Service formulas and appointment notes",
  "Waitlist",
  "No-show tracker",
  "Deposit tracking",
  "Custom business hours and blocked time",
  "Unlimited message templates",
  "Custom colors/statuses",
] as const;

export type FeatureKey =
  | "moreClients"
  | "moreServices"
  | "moreAppointments"
  | "revenueInsights"
  | "reports"
  | "fullClientHistory"
  | "unlimitedMessageTemplates"
  | "customTagsStatusesColors"
  | "smsAutomation"
  | "smartReminders"
  | "waitlist"
  | "noShowTracker"
  | "depositTracking"
  | "photoGallery"
  | "serviceFormulas"
  | "customBusinessHours";

export function isPro() {
  return false;
}

export function canUseFeature(feature: FeatureKey) {
  switch (feature) {
    case "moreClients":
    case "moreServices":
    case "moreAppointments":
    case "revenueInsights":
    case "reports":
    case "fullClientHistory":
    case "unlimitedMessageTemplates":
    case "customTagsStatusesColors":
    case "smsAutomation":
    case "smartReminders":
    case "waitlist":
    case "noShowTracker":
    case "depositTracking":
    case "photoGallery":
    case "serviceFormulas":
    case "customBusinessHours":
      return isPro();
    default:
      return false;
  }
}

