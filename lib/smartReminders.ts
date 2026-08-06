import { supabase } from "./supabase";
import {
  getRebookingDueDate,
  type RebookingIntervalUnit,
} from "./smartReminderUtils";
import {
  isSmartReminderBlocked,
  type SmartReminderAction,
  type SmartReminderRecord,
} from "./smartReminderState";

export { getRebookingDueDate } from "./smartReminderUtils";

export const SMART_REMINDERS_ENABLED =
  process.env.EXPO_PUBLIC_ENABLE_SMART_REMINDERS === "true";

type RebookingService = {
  id: string;
  name: string | null;
  rebooking_interval_value: number | null;
  rebooking_interval_unit: RebookingIntervalUnit | null;
};

type CompletedAppointment = {
  id: string;
  client_id: string | null;
  client_name: string | null;
  appointment_date: string | null;
  service_id: string | null;
  service_ids: string[] | string | null;
};

export type DueRebookingClient = {
  clientId: string;
  clientName: string;
  serviceId: string;
  serviceName: string;
  dueOn: string;
  appointmentId: string;
  lastCompletedOn: string;
};

type SmartReminderDbRecord = SmartReminderRecord & {
  client_id: string;
  service_id: string;
  due_on: string;
};

export type SmartReminderMutationInput = {
  userId: string;
  reminder: Pick<DueRebookingClient, "clientId" | "serviceId" | "dueOn">;
  action: SmartReminderAction;
  remindAfter?: string | null;
};

function dateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getServiceIds(appointment: CompletedAppointment) {
  if (Array.isArray(appointment.service_ids)) return appointment.service_ids.map(String);
  if (typeof appointment.service_ids === "string") {
    return appointment.service_ids
      .replace(/[{}[\]"]/g, "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return appointment.service_id ? [String(appointment.service_id)] : [];
}

export async function getDueRebookingClients(userId: string): Promise<DueRebookingClient[]> {
  if (!SMART_REMINDERS_ENABLED || !userId) return [];

  const [servicesResult, appointmentsResult, dismissalsResult] = await Promise.all([
    supabase
      .from("services")
      .select("id, name, rebooking_interval_value, rebooking_interval_unit")
      .eq("user_id", userId)
      .not("rebooking_interval_value", "is", null),
    supabase
      .from("appointments")
      .select("id, client_id, client_name, appointment_date, service_id, service_ids")
      .eq("user_id", userId)
      .eq("status", "completed")
      .order("appointment_date", { ascending: false }),
    supabase
      .from("smart_reminder_dismissals")
      .select("client_id, service_id, due_on, action, remind_after")
      .eq("user_id", userId),
  ]);

  if (servicesResult.error) throw servicesResult.error;
  if (appointmentsResult.error) throw appointmentsResult.error;
  if (dismissalsResult.error) throw dismissalsResult.error;

  const services = (servicesResult.data || []) as RebookingService[];
  const serviceById = new Map(services.map((service) => [service.id, service]));
  const seen = new Set<string>();
  const reminderRecords = new Map(
    ((dismissalsResult.data || []) as SmartReminderDbRecord[]).map((record) => [
      `${record.client_id}:${record.service_id}:${record.due_on}`,
      record,
    ]),
  );
  const today = dateOnly(new Date());
  const due: DueRebookingClient[] = [];

  for (const appointment of (appointmentsResult.data || []) as CompletedAppointment[]) {
    if (!appointment.client_id || !appointment.appointment_date) continue;
    for (const serviceId of getServiceIds(appointment)) {
      const service = serviceById.get(serviceId);
      if (!service?.rebooking_interval_value || !service.rebooking_interval_unit) continue;
      const key = `${appointment.client_id}:${serviceId}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const dueOn = getRebookingDueDate(
        appointment.appointment_date,
        Number(service.rebooking_interval_value),
        service.rebooking_interval_unit,
      );
      const dismissalKey = `${appointment.client_id}:${serviceId}:${dueOn}`;
      if (
        !dueOn ||
        dueOn > today ||
        isSmartReminderBlocked(reminderRecords.get(dismissalKey))
      ) {
        continue;
      }

      due.push({
        clientId: appointment.client_id,
        clientName: appointment.client_name || "Client",
        serviceId,
        serviceName: service.name || "Service",
        dueOn,
        appointmentId: appointment.id,
        lastCompletedOn: appointment.appointment_date,
      });
    }
  }

  return due;
}

function isDuplicateReminderError(error: { code?: string | null } | null) {
  return error?.code === "23505";
}

export async function createSmartReminderAction(
  input: SmartReminderMutationInput,
) {
  const { userId, reminder, action, remindAfter = null } = input;

  // A snooze has served its purpose once its date passes. Reuse that same
  // due-period record rather than creating a duplicate or blocking review.
  const { data: expiredSnooze, error: expiredSnoozeError } = await supabase
    .from("smart_reminder_dismissals")
    .update({
      action,
      remind_after: action === "remind_later" ? remindAfter : null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("client_id", reminder.clientId)
    .eq("service_id", reminder.serviceId)
    .eq("due_on", reminder.dueOn)
    .eq("action", "remind_later")
    .lt("remind_after", new Date().toISOString())
    .select("id")
    .maybeSingle();

  if (expiredSnoozeError) throw expiredSnoozeError;
  if (expiredSnooze?.id) return true;

  const { error } = await supabase.from("smart_reminder_dismissals").insert({
    user_id: userId,
    client_id: reminder.clientId,
    service_id: reminder.serviceId,
    due_on: reminder.dueOn,
    action,
    remind_after: action === "remind_later" ? remindAfter : null,
  });

  if (isDuplicateReminderError(error)) return false;
  if (error) throw error;
  return true;
}

export async function completeSmartReminderSend(
  input: Omit<SmartReminderMutationInput, "action" | "remindAfter">,
) {
  const { error } = await supabase
    .from("smart_reminder_dismissals")
    .update({ action: "sent", remind_after: null, updated_at: new Date().toISOString() })
    .eq("user_id", input.userId)
    .eq("client_id", input.reminder.clientId)
    .eq("service_id", input.reminder.serviceId)
    .eq("due_on", input.reminder.dueOn)
    .eq("action", "sending");

  if (error) throw error;
}

export async function releaseSmartReminderSend(
  input: Omit<SmartReminderMutationInput, "action" | "remindAfter">,
) {
  const { error } = await supabase
    .from("smart_reminder_dismissals")
    .delete()
    .eq("user_id", input.userId)
    .eq("client_id", input.reminder.clientId)
    .eq("service_id", input.reminder.serviceId)
    .eq("due_on", input.reminder.dueOn)
    .eq("action", "sending");

  if (error) throw error;
}
