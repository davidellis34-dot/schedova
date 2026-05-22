import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

const isExpoGo = Constants.appOwnership === "expo";
const isAndroidExpoGo = Platform.OS === "android" && isExpoGo;

const canUseLocalNotifications = Platform.OS !== "web" && !isAndroidExpoGo;

const STORAGE_KEY = "appointment_local_notification_ids";
const CHANNEL_ID = "appointment-reminders";
const DEFAULT_REMINDER_MINUTES_BEFORE = 30;

type ExpoNotifications = typeof import("expo-notifications");
type NotificationMap = Record<string, string>;

export type AppointmentReminderInput = {
  appointmentId: string;
  clientName?: string | null;
  appointmentDate: string;
  appointmentTime: string;
  reminderMinutesBefore?: number;
};

let notificationHandlerConfigured = false;

async function getNotifications(): Promise<ExpoNotifications | null> {
  if (!canUseLocalNotifications) {
    return null;
  }

  return await import("expo-notifications");
}

async function configureNotificationHandler() {
  if (notificationHandlerConfigured) return true;

  const Notifications = await getNotifications();
  if (!Notifications) return false;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  notificationHandlerConfigured = true;
  return true;
}

async function readNotificationMap(): Promise<NotificationMap> {
  const saved = await AsyncStorage.getItem(STORAGE_KEY);

  if (!saved) return {};

  try {
    return JSON.parse(saved);
  } catch {
    return {};
  }
}

async function writeNotificationMap(map: NotificationMap) {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

async function ensureNotificationSetup() {
  const Notifications = await getNotifications();
  if (!Notifications) return false;

  await configureNotificationHandler();

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "Appointment reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: "default",
    });
  }

  const existingPermissions = await Notifications.getPermissionsAsync();

  if (
    existingPermissions.granted ||
    existingPermissions.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL
  ) {
    return true;
  }

  if (existingPermissions.canAskAgain === false) return false;

  const requestedPermissions = await Notifications.requestPermissionsAsync();

  return (
    requestedPermissions.granted ||
    requestedPermissions.ios?.status ===
      Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

function parseAppointmentDateTime(dateText: string, timeText: string) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  const [hour, minute] = String(timeText || "09:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  if (!year || !month || !day) return null;

  return new Date(
    year,
    month - 1,
    day,
    Number.isFinite(hour) ? hour : 9,
    Number.isFinite(minute) ? minute : 0,
    0,
    0,
  );
}

function formatTime(timeText: string) {
  const [hourText, minuteText = "00"] = String(timeText || "09:00")
    .slice(0, 5)
    .split(":");

  let hour = Number(hourText);

  if (Number.isNaN(hour)) return String(timeText || "");

  const suffix = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;

  return `${hour}:${minuteText.padStart(2, "0")} ${suffix}`;
}

export async function cancelAppointmentReminder(appointmentId: string) {
  if (!appointmentId || !canUseLocalNotifications) return;

  const Notifications = await getNotifications();
  if (!Notifications) return;

  try {
    const notificationMap = await readNotificationMap();
    const notificationId = notificationMap[appointmentId];

    if (notificationId) {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      delete notificationMap[appointmentId];
      await writeNotificationMap(notificationMap);
    }
  } catch {
    // Appointment saves/deletes should not fail because local reminders fail.
  }
}

export async function scheduleAppointmentReminder({
  appointmentId,
  clientName,
  appointmentDate,
  appointmentTime,
  reminderMinutesBefore = DEFAULT_REMINDER_MINUTES_BEFORE,
}: AppointmentReminderInput) {
  if (!appointmentId || !canUseLocalNotifications) return null;

  const Notifications = await getNotifications();
  if (!Notifications) return null;

  try {
    const canSchedule = await ensureNotificationSetup();

    if (!canSchedule) return null;

    const appointmentDateTime = parseAppointmentDateTime(
      appointmentDate,
      appointmentTime,
    );

    if (!appointmentDateTime || appointmentDateTime.getTime() <= Date.now()) {
      await cancelAppointmentReminder(appointmentId);
      return null;
    }

    await cancelAppointmentReminder(appointmentId);

    const reminderTime = new Date(
      appointmentDateTime.getTime() - reminderMinutesBefore * 60 * 1000,
    );

    if (reminderTime.getTime() <= Date.now()) {
      reminderTime.setTime(Date.now() + 5000);
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Upcoming appointment",
        body: `${clientName || "Appointment"} at ${formatTime(
          appointmentTime,
        )}`,
        sound: true,
        data: {
          appointmentId,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderTime,
        channelId: CHANNEL_ID,
      },
    });

    const notificationMap = await readNotificationMap();
    notificationMap[appointmentId] = notificationId;
    await writeNotificationMap(notificationMap);

    return notificationId;
  } catch {
    return null;
  }
}

export async function scheduleAppointmentReminders(
  appointments: AppointmentReminderInput[],
) {
  await Promise.all(
    appointments.map((appointment) => scheduleAppointmentReminder(appointment)),
  );
}
