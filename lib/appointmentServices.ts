export type AppointmentServiceSnapshot = {
  id: string;
  name: string;
  duration_minutes: number;
  price: number;
  color_hex?: string;
};

function normalizeId(value: unknown) {
  return value == null ? "" : String(value);
}

function parseServiceIds(appointment: any) {
  const rawServiceIds = appointment?.service_ids;

  if (Array.isArray(rawServiceIds)) {
    return rawServiceIds.map(String).filter(Boolean);
  }

  if (typeof rawServiceIds === "string") {
    return rawServiceIds
      .replace("{", "")
      .replace("}", "")
      .replace("[", "")
      .replace("]", "")
      .replace(/"/g, "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (appointment?.service_id) {
    return [String(appointment.service_id)];
  }

  return [];
}

function parseServiceSnapshots(value: unknown) {
  if (Array.isArray(value)) return value;

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function numberWithDefault(value: unknown, fallback: number) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toServiceSnapshot(service: unknown): AppointmentServiceSnapshot | null {
  if (!service || typeof service !== "object") return null;

  const rawService = service as {
    id?: unknown;
    name?: unknown;
    duration_minutes?: unknown;
    price?: unknown;
    color_hex?: unknown;
  };
  const id = normalizeId(rawService.id);

  if (!id) return null;

  const name =
    typeof rawService.name === "string" && rawService.name.trim()
      ? rawService.name.trim()
      : "Unnamed Service";
  const duration = numberWithDefault(rawService.duration_minutes, 0);
  const price = numberWithDefault(rawService.price, 0);
  const color =
    typeof rawService.color_hex === "string" && rawService.color_hex.trim()
      ? rawService.color_hex.trim()
      : "";

  return {
    id,
    name,
    duration_minutes: duration >= 0 ? duration : 0,
    price: price >= 0 ? price : 0,
    ...(color ? { color_hex: color } : {}),
  };
}

export function createServiceSnapshots(
  services: unknown[] = [],
): AppointmentServiceSnapshot[] {
  const serviceList = Array.isArray(services) ? services : [];
  const snapshots: AppointmentServiceSnapshot[] = [];

  for (const service of serviceList) {
    const snapshot = toServiceSnapshot(service);
    if (snapshot) snapshots.push(snapshot);
  }

  return snapshots;
}

export function getAppointmentServices(
  appointment: any,
  services: unknown[] = [],
): AppointmentServiceSnapshot[] {
  const snapshots = parseServiceSnapshots(appointment?.service_snapshots);
  const serviceList = Array.isArray(services) ? services : [];

  if (snapshots.length > 0) {
    return createServiceSnapshots(snapshots);
  }

  const matchedServices: unknown[] = [];

  for (const serviceId of parseServiceIds(appointment)) {
    const matchedService =
      serviceList.find(
        (service: any) => normalizeId(service?.id) === normalizeId(serviceId),
      ) || null;

    if (matchedService) matchedServices.push(matchedService);
  }

  return createServiceSnapshots(matchedServices);
}

export function getAppointmentServiceTotal(appointment: any, services: any[] = []) {
  return getAppointmentServices(appointment, services).reduce(
    (sum, service) => sum + Number(service.price || 0),
    0,
  );
}

export function getAppointmentDurationTotal(
  appointment: any,
  services: any[] = [],
) {
  return getAppointmentServices(appointment, services).reduce(
    (sum, service) => sum + Number(service.duration_minutes || 0),
    0,
  );
}

export function getAppointmentServiceNames(appointment: any, services: any[] = []) {
  return getAppointmentServices(appointment, services)
    .map((service) => service.name)
    .filter(Boolean);
}
