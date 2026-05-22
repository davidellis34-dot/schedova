import {
  sendAppointmentSms,
  sendAppointmentSmsNonBlocking,
} from "./appointmentSms";

export { sendAppointmentSms, sendAppointmentSmsNonBlocking };

export async function sendTextReminder(appointmentId: string) {
  return await sendAppointmentSms(appointmentId, "reminder");
}
