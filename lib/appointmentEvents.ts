type AppointmentEventListener = (event: AppointmentEvent) => void;

export type AppointmentEvent =
  | {
      type: "upsert";
      appointments: Record<string, unknown>[];
    }
  | {
      type: "delete";
      appointmentIds: string[];
    };

const appointmentEventListeners = new Set<AppointmentEventListener>();

function normalizeAppointmentId(value: unknown) {
  return String(value || "").trim();
}

function getAppointmentId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  return normalizeAppointmentId((value as { id?: unknown }).id);
}

export function emitAppointmentUpserted(appointments: unknown[]) {
  const normalizedAppointments = Array.isArray(appointments)
    ? appointments.filter(
        (appointment): appointment is Record<string, unknown> =>
          Boolean(getAppointmentId(appointment)),
      )
    : [];

  if (normalizedAppointments.length === 0) return;

  for (const listener of appointmentEventListeners) {
    listener({
      type: "upsert",
      appointments: normalizedAppointments,
    });
  }
}

export function emitAppointmentDeleted(appointmentIds: unknown[]) {
  const normalizedIds = Array.isArray(appointmentIds)
    ? appointmentIds.map(normalizeAppointmentId).filter(Boolean)
    : [];

  if (normalizedIds.length === 0) return;

  for (const listener of appointmentEventListeners) {
    listener({
      type: "delete",
      appointmentIds: normalizedIds,
    });
  }
}

export function mergeAppointmentsById<T extends { id?: unknown }>(
  currentAppointments: T[],
  incomingAppointments: T[],
) {
  const appointmentsById = new Map<string, T>();

  for (const appointment of currentAppointments) {
    const appointmentId = normalizeAppointmentId(appointment?.id);
    if (!appointmentId) continue;
    appointmentsById.set(appointmentId, appointment);
  }

  for (const appointment of incomingAppointments) {
    const appointmentId = normalizeAppointmentId(appointment?.id);
    if (!appointmentId) continue;
    appointmentsById.set(appointmentId, appointment);
  }

  return Array.from(appointmentsById.values());
}

export function subscribeToAppointmentEvents(listener: AppointmentEventListener) {
  appointmentEventListeners.add(listener);

  return () => {
    appointmentEventListeners.delete(listener);
  };
}
