import {
  hasSchedovaProAccess,
  type UserSubscription,
} from "./subscriptionAccess";

export const FREE_TIER_LIMITS = {
  clients: 25,
  services: 5,
  appointmentsPerMonth: 50,
  messageTemplates: 3,
  clientHistoryItems: 3,
} as const;

type ClientLimitRow = {
  archived_at?: string | null;
};

type AppointmentLimitRow = {
  appointment_date?: string | null;
  status?: string | null;
  deleted_at?: string | null;
};

type ClientCreationAccessInput = {
  activeClientCount: number;
  isUnlimited: boolean;
  limit?: number;
};

type AppointmentCreationAccessInput = {
  existingCount: number;
  requestedCount?: number;
  isUnlimited: boolean;
  limit?: number;
};

function toDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function hasUnlimitedFreePlanAccess(
  subscription: UserSubscription | null | undefined,
) {
  return hasSchedovaProAccess(subscription);
}

export function isClientCountedForFreeLimit(client?: ClientLimitRow | null) {
  return !client?.archived_at;
}

export function countActiveClients(rows: ClientLimitRow[]) {
  return rows.filter(isClientCountedForFreeLimit).length;
}

export function getClientCreationAccess({
  activeClientCount,
  isUnlimited,
  limit = FREE_TIER_LIMITS.clients,
}: ClientCreationAccessInput) {
  const overLimit = !isUnlimited && activeClientCount > limit;
  const atLimit = !isUnlimited && activeClientCount >= limit;

  return {
    atLimit,
    canCreate: isUnlimited || activeClientCount < limit,
    canEditExisting: true,
    limit,
    overLimit,
  };
}

export function getCurrentLocalMonthKey(now = new Date()) {
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

export function getLocalMonthBounds(monthKey: string) {
  const [yearText, monthText] = String(monthKey || "").split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) {
    return {
      end: "",
      start: "",
    };
  }

  const startDate = new Date(year, monthIndex, 1);
  const endDate = new Date(year, monthIndex + 1, 0);

  return {
    end: toDateOnly(endDate),
    start: toDateOnly(startDate),
  };
}

export function countDatesByMonth(dates: string[]) {
  return dates.reduce<Record<string, number>>((counts, date) => {
    const cleanDate = String(date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      return counts;
    }

    const monthKey = cleanDate.slice(0, 7);
    counts[monthKey] = (counts[monthKey] || 0) + 1;
    return counts;
  }, {});
}

export function isAppointmentCountedForFreeLimit(
  appointment?: AppointmentLimitRow | null,
  monthKey?: string | null,
) {
  if (!appointment) return false;
  if (appointment.deleted_at) return false;

  const normalizedStatus = String(appointment.status || "").trim().toLowerCase();
  if (normalizedStatus === "canceled" || normalizedStatus === "cancelled") {
    return false;
  }

  const appointmentDate = String(appointment.appointment_date || "").trim();
  if (!appointmentDate) return false;

  if (monthKey && appointmentDate.slice(0, 7) !== monthKey) {
    return false;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(appointmentDate);
}

export function countAppointmentsInMonth(
  rows: AppointmentLimitRow[],
  monthKey: string,
) {
  return rows.filter((row) => isAppointmentCountedForFreeLimit(row, monthKey))
    .length;
}

export function getAppointmentCreationAccess({
  existingCount,
  requestedCount = 1,
  isUnlimited,
  limit = FREE_TIER_LIMITS.appointmentsPerMonth,
}: AppointmentCreationAccessInput) {
  const nextTotal = existingCount + requestedCount;
  const overLimit = !isUnlimited && existingCount > limit;
  const atLimit = !isUnlimited && existingCount >= limit;

  return {
    atLimit,
    canCreate: isUnlimited || nextTotal <= limit,
    canEditExisting: true,
    limit,
    nextTotal,
    overLimit,
  };
}
