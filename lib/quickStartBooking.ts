import { toSqlTime } from "../components/booking/bookingUtils";
import { cleanDateOnly, isValidDateOnly } from "../components/booking/dateUtils";
import {
  getCalendarPreferences,
  type CalendarIntervalMinutes,
} from "./calendarPreferences";
import { getSuggestedBookingDateTime } from "./bookingDefaultTime";
import { canUseFeature } from "./featureAccess";
import {
  FREE_TIER_LIMITS,
  countActiveClients,
  getClientCreationAccess,
} from "./freePlanLimits";
import {
  PRO_UPSELL_COPY,
  showFreePlanUpgradePrompt,
  showProUpgradePrompt,
} from "./proUpsell";
import {
  findReusableQuickStartClient,
  findReusableQuickStartService,
  normalizeQuickStartId,
  quickStartNumber,
  type QuickStartClient,
  type QuickStartService,
} from "./quickStartMatching";
import { supabase } from "./supabase";
import { trackAnalyticsEvent } from "./analytics";

export {
  findReusableQuickStartClient,
  findReusableQuickStartService,
  normalizeQuickStartId,
  quickStartNumber,
} from "./quickStartMatching";
export type { QuickStartClient, QuickStartService } from "./quickStartMatching";

export type QuickStartLoadResult = {
  clients: QuickStartClient[];
  services: QuickStartService[];
  hasAppointment: boolean;
  intervalMinutes: CalendarIntervalMinutes;
  use24Hour: boolean;
  defaultDate: string;
  defaultTime: string;
};

export type QuickStartPrepareInput = {
  userId: string;
  clientName: string;
  clientPhone: string;
  serviceName: string;
  servicePrice: string;
  durationMinutes: number;
  appointmentDate: string;
  appointmentTime: string;
  clients: QuickStartClient[];
  services: QuickStartService[];
  selectedClientId?: string;
  selectedServiceId?: string;
};

export type QuickStartPrepareResult = {
  appointmentDate: string;
  appointmentTime: string;
  client: QuickStartClient;
  clientCreated: boolean;
  clientId: string;
  clientName: string;
  service: QuickStartService;
  serviceCreated: boolean;
  serviceId: string;
  serviceName: string;
};

export class QuickStartBookingError extends Error {
  title: string;

  constructor(title: string, message: string) {
    super(message);
    this.name = "QuickStartBookingError";
    this.title = title;
  }
}

export async function loadQuickStartBooking(
  userId: string,
): Promise<QuickStartLoadResult> {
  const [preferences, clientResult, serviceResult, appointmentResult] =
    await Promise.all([
      getCalendarPreferences(),
      supabase.from("clients").select("*").eq("user_id", userId),
      supabase.from("services").select("*").eq("user_id", userId),
      supabase
        .from("appointments")
        .select("id")
        .eq("user_id", userId)
        .limit(1),
    ]);

  if (clientResult.error) {
    console.log("[QuickStart] client lookup failed", clientResult.error);
  }
  if (serviceResult.error) {
    console.log("[QuickStart] service lookup failed", serviceResult.error);
  }
  if (appointmentResult.error) {
    console.log("[QuickStart] appointment lookup failed", appointmentResult.error);
  }

  const clients = ((clientResult.data || []) as QuickStartClient[])
    .filter((client) => client?.id && !client.archived_at)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const services = ((serviceResult.data || []) as QuickStartService[])
    .filter((service) => service?.id)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const defaults = getSuggestedBookingDateTime({
    intervalMinutes: preferences.intervalMinutes,
  });

  return {
    clients,
    services,
    hasAppointment:
      !appointmentResult.error && (appointmentResult.data || []).length > 0,
    intervalMinutes: preferences.intervalMinutes,
    use24Hour: preferences.timeFormat === "24h",
    defaultDate: defaults.date,
    defaultTime: defaults.time,
  };
}

async function resolveClient(input: {
  userId: string;
  clients: QuickStartClient[];
  selectedClientId?: string;
  name: string;
  phone: string;
}) {
  const reusable = findReusableQuickStartClient(input);
  if (reusable) return { client: reusable, created: false };

  const access = getClientCreationAccess({
    activeClientCount: countActiveClients(input.clients),
    isUnlimited: canUseFeature("moreClients"),
    limit: FREE_TIER_LIMITS.clients,
  });
  if (!access.canCreate) {
    trackAnalyticsEvent("client_create_failed", {
      screen_name: "quick_start",
      flow: "first_booking_activation",
      entry_type: "client",
      result: "failed",
      reason_code: "free_limit",
      is_first: countActiveClients(input.clients) === 0,
    });
    showFreePlanUpgradePrompt();
    return null;
  }

  trackAnalyticsEvent("client_create_started", {
    screen_name: "quick_start",
    flow: "first_booking_activation",
    entry_type: "client",
    result: "started",
    is_first: countActiveClients(input.clients) === 0,
  });

  const { data, error } = await supabase
    .from("clients")
    .insert({
      user_id: input.userId,
      name: input.name,
      phone: input.phone || null,
      email: null,
    })
    .select("*")
    .single();

  if (error || !data?.id) {
    trackAnalyticsEvent("client_create_failed", {
      screen_name: "quick_start",
      flow: "first_booking_activation",
      entry_type: "client",
      result: "failed",
      reason_code: "database_error",
      is_first: countActiveClients(input.clients) === 0,
    });
    throw error || new Error("Client could not be saved.");
  }

  trackAnalyticsEvent("client_created", {
    screen_name: "quick_start",
    flow: "first_booking_activation",
    entry_type: "client",
    result: "success",
    is_first: countActiveClients(input.clients) === 0,
  });

  return {
    client: { ...data, id: normalizeQuickStartId(data.id) } as QuickStartClient,
    created: true,
  };
}

async function resolveService(input: {
  userId: string;
  services: QuickStartService[];
  selectedServiceId?: string;
  name: string;
  price: number;
  duration: number;
}) {
  const reusable = findReusableQuickStartService(input);
  if (reusable) return { service: reusable, created: false };

  if (
    !canUseFeature("moreServices") &&
    input.services.length >= FREE_TIER_LIMITS.services
  ) {
    trackAnalyticsEvent("service_create_failed", {
      screen_name: "quick_start",
      flow: "first_booking_activation",
      entry_type: "service",
      result: "failed",
      reason_code: "free_limit",
      is_first: input.services.length === 0,
    });
    showProUpgradePrompt(PRO_UPSELL_COPY.moreServices);
    return null;
  }

  trackAnalyticsEvent("service_create_started", {
    screen_name: "quick_start",
    flow: "first_booking_activation",
    entry_type: "service",
    result: "started",
    is_first: input.services.length === 0,
  });

  const { data, error } = await supabase
    .from("services")
    .insert({
      user_id: input.userId,
      name: input.name,
      price: input.price,
      duration_minutes: input.duration,
      color_hex: "#2563EB",
    })
    .select("*")
    .single();

  if (error || !data?.id) {
    trackAnalyticsEvent("service_create_failed", {
      screen_name: "quick_start",
      flow: "first_booking_activation",
      entry_type: "service",
      result: "failed",
      reason_code: "database_error",
      is_first: input.services.length === 0,
    });
    throw error || new Error("Service could not be saved.");
  }

  trackAnalyticsEvent("service_created", {
    screen_name: "quick_start",
    flow: "first_booking_activation",
    entry_type: "service",
    result: "success",
    is_first: input.services.length === 0,
  });

  return {
    service: { ...data, id: normalizeQuickStartId(data.id) } as QuickStartService,
    created: true,
  };
}

export async function prepareQuickStartBooking(
  input: QuickStartPrepareInput,
): Promise<QuickStartPrepareResult | null> {
  const cleanClientName = input.clientName.trim();
  const cleanClientPhone = input.clientPhone.trim();
  const cleanServiceName = input.serviceName.trim();
  const cleanDate = cleanDateOnly(input.appointmentDate);
  const cleanStartTime = toSqlTime(input.appointmentTime, "");
  const duration = Math.round(Number(input.durationMinutes));
  const price = input.servicePrice.trim() ? Number(input.servicePrice) : 0;

  if (!input.userId) {
    throw new QuickStartBookingError("Login required", "Please sign in again.");
  }
  if (!cleanClientName) {
    throw new QuickStartBookingError(
      "Add a client",
      "Enter the client's name to continue.",
    );
  }
  if (!cleanServiceName) {
    throw new QuickStartBookingError(
      "Add a service",
      "Enter the service for this appointment.",
    );
  }
  if (!isValidDateOnly(cleanDate)) {
    throw new QuickStartBookingError(
      "Choose a date",
      "Select a valid appointment date.",
    );
  }
  if (!cleanStartTime) {
    throw new QuickStartBookingError(
      "Choose a time",
      "Select a valid appointment time.",
    );
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new QuickStartBookingError(
      "Choose a duration",
      "Duration must be greater than zero.",
    );
  }
  if (!Number.isFinite(price) || price < 0) {
    throw new QuickStartBookingError(
      "Check the price",
      "Price must be zero or higher.",
    );
  }

  const clientResult = await resolveClient({
    userId: input.userId,
    clients: input.clients,
    selectedClientId: input.selectedClientId,
    name: cleanClientName,
    phone: cleanClientPhone,
  });
  if (!clientResult) return null;

  const serviceResult = await resolveService({
    userId: input.userId,
    services: input.services,
    selectedServiceId: input.selectedServiceId,
    name: cleanServiceName,
    price,
    duration,
  });
  if (!serviceResult) return null;

  const clientId = normalizeQuickStartId(clientResult.client.id);
  const serviceId = normalizeQuickStartId(serviceResult.service.id);
  if (!clientId || !serviceId) {
    throw new Error("The client or service could not be prepared.");
  }

  return {
    appointmentDate: cleanDate,
    appointmentTime: cleanStartTime.slice(0, 5),
    client: clientResult.client,
    clientCreated: clientResult.created,
    clientId,
    clientName: cleanClientName,
    service: serviceResult.service,
    serviceCreated: serviceResult.created,
    serviceId,
    serviceName: cleanServiceName,
  };
}
