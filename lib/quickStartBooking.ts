import {
  calculateEndTime,
  toSqlTime,
} from "../components/booking/bookingUtils";
import { cleanDateOnly, isValidDateOnly } from "../components/booking/dateUtils";
import { createServiceSnapshots } from "./appointmentServices";
import {
  getCalendarPreferences,
  type CalendarIntervalMinutes,
} from "./calendarPreferences";
import { canUseFeature } from "./featureAccess";
import {
  FREE_TIER_LIMITS,
  countActiveClients,
  getAppointmentCreationAccess,
  getClientCreationAccess,
  getLocalMonthBounds,
} from "./freePlanLimits";
import { buildSkippedOnboardingBusinessPayload } from "./onboardingFlow";
import {
  PRO_UPSELL_COPY,
  showFreePlanUpgradePrompt,
  showProUpgradePrompt,
} from "./proUpsell";
import { supabase } from "./supabase";

export type QuickStartClient = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  archived_at?: string | null;
};

export type QuickStartService = {
  id: string;
  name?: string | null;
  price?: number | string | null;
  duration_minutes?: number | string | null;
  color_hex?: string | null;
};

export type QuickStartLoadResult = {
  clients: QuickStartClient[];
  services: QuickStartService[];
  hasAppointment: boolean;
  intervalMinutes: CalendarIntervalMinutes;
  use24Hour: boolean;
  defaultDate: string;
  defaultTime: string;
};

export type QuickStartBookingInput = {
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

export type QuickStartBookingResult = {
  appointment: Record<string, unknown>;
  appointmentId: string;
  appointmentDate: string;
  appointmentTime: string;
  businessId: string;
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

export function normalizeQuickStartId(value: unknown) {
  return value == null ? "" : String(value);
}

export function quickStartNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedName(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function phoneDigits(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

function timeToMinutes(value: string) {
  const [hourText, minuteText] = String(value || "").slice(0, 5).split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return Number.NaN;
  }

  return hours * 60 + minutes;
}

function isDeliveryFlagSchemaError(error: unknown) {
  const message = String((error as { message?: unknown } | null)?.message || "")
    .toLocaleLowerCase();

  return (
    message.includes("sms_notifications_enabled") ||
    message.includes("email_notifications_enabled")
  );
}

function getDefaultBookingDateTime(input: {
  intervalMinutes: number;
  startHour: number;
  endHour: number;
}) {
  const safeInterval =
    Number.isFinite(input.intervalMinutes) && input.intervalMinutes > 0
      ? Math.max(5, Math.min(60, Math.round(input.intervalMinutes)))
      : 30;
  const startHour = Number.isFinite(input.startHour)
    ? Math.max(0, Math.min(23, Math.floor(input.startHour)))
    : 9;
  const endHour = Number.isFinite(input.endHour)
    ? Math.max(startHour + 1, Math.min(24, Math.floor(input.endHour)))
    : 18;
  const next = new Date();

  next.setMinutes(next.getMinutes() + 30, 0, 0);
  next.setMinutes(
    Math.ceil(next.getMinutes() / safeInterval) * safeInterval,
    0,
    0,
  );

  if (next.getHours() < startHour) {
    next.setHours(startHour, 0, 0, 0);
  } else if (
    next.getHours() >= endHour ||
    (next.getHours() === endHour - 1 && next.getMinutes() > 0)
  ) {
    next.setDate(next.getDate() + 1);
    next.setHours(startHour, 0, 0, 0);
  }

  return {
    date: `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(next.getDate()).padStart(2, "0")}`,
    time: `${String(next.getHours()).padStart(2, "0")}:${String(
      next.getMinutes(),
    ).padStart(2, "0")}`,
  };
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
  const defaults = getDefaultBookingDateTime({
    intervalMinutes: preferences.intervalMinutes,
    startHour: preferences.startHour,
    endHour: preferences.endHour,
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

export async function ensureQuickStartBusinessProfile(userId: string) {
  try {
    const existingResult = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    if (!existingResult.error && existingResult.data?.[0]?.id) {
      return normalizeQuickStartId(existingResult.data[0].id);
    }

    const createResult = await supabase
      .from("businesses")
      .insert({
        user_id: userId,
        ...buildSkippedOnboardingBusinessPayload({}),
      })
      .select("id")
      .single();

    if (!createResult.error && createResult.data?.id) {
      return normalizeQuickStartId(createResult.data.id);
    }

    const retryResult = await supabase
      .from("businesses")
      .select("id")
      .eq("user_id", userId)
      .limit(1);

    return normalizeQuickStartId(retryResult.data?.[0]?.id);
  } catch (error) {
    // Business details can be completed later. They must never block the first
    // useful scheduling action.
    console.log("[QuickStart] business profile save deferred", error);
    return "";
  }
}

async function canCreateAppointment(userId: string, date: string) {
  if (canUseFeature("moreAppointments")) return true;

  const { start, end } = getLocalMonthBounds(date.slice(0, 7));
  if (!start || !end) {
    throw new QuickStartBookingError(
      "Choose a date",
      "Select a valid appointment date.",
    );
  }

  const { data, error } = await supabase
    .from("appointments")
    .select("id")
    .eq("user_id", userId)
    .gte("appointment_date", start)
    .lte("appointment_date", end)
    .neq("status", "canceled");

  if (error) throw error;

  const access = getAppointmentCreationAccess({
    existingCount: (data || []).length,
    requestedCount: 1,
    isUnlimited: false,
    limit: FREE_TIER_LIMITS.appointmentsPerMonth,
  });

  if (!access.canCreate) {
    showFreePlanUpgradePrompt();
    return false;
  }

  return true;
}

async function resolveClient(input: {
  userId: string;
  clients: QuickStartClient[];
  selectedClientId?: string;
  name: string;
  phone: string;
}) {
  const selected = input.clients.find(
    (client) =>
      normalizeQuickStartId(client.id) === normalizeQuickStartId(input.selectedClientId),
  );
  if (selected) return { client: selected, created: false };

  const matchingName = input.clients.filter(
    (client) => normalizedName(client.name) === normalizedName(input.name),
  );
  const reusable =
    matchingName.length === 1 &&
    (!input.phone || phoneDigits(matchingName[0].phone) === phoneDigits(input.phone))
      ? matchingName[0]
      : null;
  if (reusable) return { client: reusable, created: false };

  const access = getClientCreationAccess({
    activeClientCount: countActiveClients(input.clients),
    isUnlimited: canUseFeature("moreClients"),
    limit: FREE_TIER_LIMITS.clients,
  });
  if (!access.canCreate) {
    showFreePlanUpgradePrompt();
    return null;
  }

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
    throw error || new Error("Client could not be saved.");
  }

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
  const selected = input.services.find(
    (service) =>
      normalizeQuickStartId(service.id) ===
      normalizeQuickStartId(input.selectedServiceId),
  );
  if (selected) return { service: selected, created: false };

  const reusable = input.services.find(
    (service) =>
      normalizedName(service.name) === normalizedName(input.name) &&
      quickStartNumber(service.price, 0) === input.price &&
      quickStartNumber(service.duration_minutes, 30) === input.duration,
  );
  if (reusable) return { service: reusable, created: false };

  if (
    !canUseFeature("moreServices") &&
    input.services.length >= FREE_TIER_LIMITS.services
  ) {
    showProUpgradePrompt(PRO_UPSELL_COPY.moreServices);
    return null;
  }

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
    throw error || new Error("Service could not be saved.");
  }

  return {
    service: { ...data, id: normalizeQuickStartId(data.id) } as QuickStartService,
    created: true,
  };
}

export async function saveQuickStartBooking(
  input: QuickStartBookingInput,
): Promise<QuickStartBookingResult | null> {
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
  if (!cleanClientName && !cleanClientPhone) {
    throw new QuickStartBookingError(
      "Add a client",
      "Enter the client's name or phone number to continue.",
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

  const cleanEndTime = toSqlTime(
    calculateEndTime(cleanStartTime, duration),
    "",
  );
  if (
    !cleanEndTime ||
    timeToMinutes(cleanEndTime) <= timeToMinutes(cleanStartTime)
  ) {
    throw new QuickStartBookingError(
      "Choose an earlier time",
      "The first-booking flow cannot create an appointment that ends after midnight.",
    );
  }

  // Store the phone exactly as entered during activation. Country-aware SMS
  // formatting happens later, when the user actually chooses a messaging flow.
  const savedPhone = cleanClientPhone;
  const clientName = cleanClientName || savedPhone;

  if (!(await canCreateAppointment(input.userId, cleanDate))) return null;

  const businessIdPromise = ensureQuickStartBusinessProfile(input.userId);
  const clientResult = await resolveClient({
    userId: input.userId,
    clients: input.clients,
    selectedClientId: input.selectedClientId,
    name: clientName,
    phone: savedPhone,
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
  const serviceSnapshots = createServiceSnapshots([
    {
      id: serviceId,
      name: cleanServiceName,
      price,
      duration_minutes: duration,
      color_hex:
        String(serviceResult.service.color_hex || "").trim() || "#2563EB",
    },
  ]);

  if (!clientId || !serviceId || serviceSnapshots.length === 0) {
    throw new Error("The client or service could not be prepared.");
  }

  const baseAppointment = {
    user_id: input.userId,
    client_id: clientId,
    client_name: clientName,
    service_id: serviceId,
    service_ids: [serviceId],
    service_snapshots: serviceSnapshots,
    duration_minutes: duration,
    appointment_date: cleanDate,
    appointment_time: cleanStartTime,
    end_time: cleanEndTime,
    appointment_notes: null,
    final_price: input.servicePrice.trim() ? price : null,
    status: "scheduled",
    is_double_booked: false,
    double_booked_with: null,
    double_booking_confirmed_at: null,
    sms_notifications_enabled: false,
    email_notifications_enabled: false,
  };

  let appointmentResult = await supabase
    .from("appointments")
    .insert(baseAppointment)
    .select("*")
    .single();

  if (
    appointmentResult.error &&
    isDeliveryFlagSchemaError(appointmentResult.error)
  ) {
    const fallbackAppointment: Record<string, unknown> = {
      ...baseAppointment,
    };
    delete fallbackAppointment.sms_notifications_enabled;
    delete fallbackAppointment.email_notifications_enabled;
    appointmentResult = await supabase
      .from("appointments")
      .insert(fallbackAppointment)
      .select("*")
      .single();
  }

  if (appointmentResult.error || !appointmentResult.data?.id) {
    throw (
      appointmentResult.error || new Error("The appointment could not be saved.")
    );
  }

  return {
    appointment: appointmentResult.data as Record<string, unknown>,
    appointmentId: normalizeQuickStartId(appointmentResult.data.id),
    appointmentDate: cleanDate,
    appointmentTime: cleanStartTime,
    businessId: await businessIdPromise,
    client: clientResult.client,
    clientCreated: clientResult.created,
    clientId,
    clientName,
    service: serviceResult.service,
    serviceCreated: serviceResult.created,
    serviceId,
    serviceName: cleanServiceName,
  };
}
