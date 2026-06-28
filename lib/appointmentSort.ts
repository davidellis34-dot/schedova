type AppointmentLike = {
  id?: string | number | null;
  appointment_date?: string | null;
  appointment_time?: string | null;
};

export function normalizeAppointmentTime(value: unknown) {
  if (!value) return "";

  const text = String(value).trim();
  const ampmMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)$/i);

  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minute = Number(ampmMatch[2]);
    const meridiem = ampmMatch[3].toUpperCase();

    if (meridiem === "PM" && hour < 12) {
      hour += 12;
    }

    if (meridiem === "AM" && hour === 12) {
      hour = 0;
    }

    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(
      2,
      "0",
    )}`;
  }

  const timeMatch = text.match(/^(\d{1,2}):(\d{2})/);

  if (!timeMatch) return "";

  return `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
}

function getAppointmentStartTimestamp(appointment: AppointmentLike) {
  const [year, month, day] = String(appointment.appointment_date || "")
    .split("-")
    .map(Number);

  const normalizedTime = normalizeAppointmentTime(appointment.appointment_time);
  const [hours, minutes] = normalizedTime.split(":").map(Number);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
}

export function compareAppointmentsByStartTime(
  left: AppointmentLike,
  right: AppointmentLike,
) {
  const timestampDiff =
    getAppointmentStartTimestamp(left) - getAppointmentStartTimestamp(right);

  if (timestampDiff !== 0) {
    return timestampDiff;
  }

  const dateDiff = String(left.appointment_date || "").localeCompare(
    String(right.appointment_date || ""),
  );

  if (dateDiff !== 0) {
    return dateDiff;
  }

  const timeDiff = normalizeAppointmentTime(
    left.appointment_time,
  ).localeCompare(normalizeAppointmentTime(right.appointment_time));

  if (timeDiff !== 0) {
    return timeDiff;
  }

  return String(left.id || "").localeCompare(String(right.id || ""));
}

export function sortAppointmentsChronologically<T extends AppointmentLike>(
  appointments: T[],
) {
  return [...appointments].sort(compareAppointmentsByStartTime);
}
