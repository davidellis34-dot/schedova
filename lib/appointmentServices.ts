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

export function createServiceSnapshots(
  services: any[] = [],
): AppointmentServiceSnapshot[] {
  return services
    .filter(Boolean)
    .map((service) => ({
      id: normalizeId(service.id),
      name: String(service.name || "Unnamed Service"),
      duration_minutes: Number(service.duration_minutes || 0),
      price: Number(service.price || 0),
      ...(service.color_hex ? { color_hex: String(service.color_hex) } : {}),
    }));
}

export function getAppointmentServices(
  appointment: any,
  services: any[] = [],
): AppointmentServiceSnapshot[] {
  const snapshots = parseServiceSnapshots(appointment?.service_snapshots);

  if (snapshots.length > 0) {
    return snapshots
      .filter(Boolean)
      .map((service: any) => ({
        id: normalizeId(service.id),
        name: String(service.name || "Unnamed Service"),
        duration_minutes: Number(service.duration_minutes || 0),
        price: Number(service.price || 0),
        ...(service.color_hex ? { color_hex: String(service.color_hex) } : {}),
      }));
  }

  return parseServiceIds(appointment)
    .map((serviceId) =>
      services.find(
        (service) => normalizeId(service.id) === normalizeId(serviceId),
      ),
    )
    .filter(Boolean)
    .map((service) => ({
      id: normalizeId(service.id),
      name: String(service.name || "Unnamed Service"),
      duration_minutes: Number(service.duration_minutes || 0),
      price: Number(service.price || 0),
      ...(service.color_hex ? { color_hex: String(service.color_hex) } : {}),
    }));
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
