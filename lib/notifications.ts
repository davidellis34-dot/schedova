export {
  cancelAppointmentReminder,
  scheduleAppointmentReminder,
  scheduleAppointmentReminders,
} from "./localNotifications";

export async function requestNotificationPermission() {
  // Permission requests are handled lazily by localNotifications when a reminder
  // is scheduled. Keep this compatibility helper so older imports stay safe.
  return true;
}
