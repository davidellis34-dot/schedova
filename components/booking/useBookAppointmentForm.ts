import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

import {
  createServiceSnapshots,
  getAppointmentServices,
} from "../../lib/appointmentServices";
import { sendAppointmentSmsNonBlocking } from "../../lib/appointmentSms";
import { getCalendarPreferences } from "../../lib/calendarPreferences";
import { canUseFeature, FREE_TIER_LIMITS } from "../../lib/featureAccess";
import { scheduleAppointmentReminder } from "../../lib/localNotifications";
import { supabase } from "../../lib/supabase";
import {
  blockTitleFor,
  calculateEndTime,
  formatMoney,
  getTotalDuration,
  getTotalPrice,
  normalizeId,
  toDisplayTime,
  toSqlTime,
  todayIso,
} from "./bookingUtils";
import { cleanDateOnly } from "./dateUtils";
import type { Client, EntryType, Service } from "./types";

type RepeatType = "none" | "daily" | "weekly" | "biweekly" | "monthly";

type SavedAppointmentForSideEffects = {
  id: string;
  appointment_date: string;
  appointment_time: string;
  client_name?: string | null;
};

function normalizeEntryType(value?: string): EntryType {
  if (value === "blocked" || value === "blocked_time") return "blocked_time";
  if (value === "vacation") return "vacation";
  if (value === "personal") return "personal";
  return "appointment";
}

function addMinutesToTime(time: string, minutesToAdd: number) {
  const safeTime = toDisplayTime(time, "09:00");
  const [hourText, minuteText] = safeTime.split(":");
  const date = new Date();

  date.setHours(
    Number(hourText),
    Number(minuteText) +
      (Number.isFinite(minutesToAdd) ? minutesToAdd : 30),
    0,
    0,
  );

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function timeToMinutes(time: string) {
  const cleanTime = String(time || "00:00").slice(0, 5);
  const [hourText, minuteText] = cleanTime.split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return Number.NaN;

  return hours * 60 + minutes;
}

function parseDateOnly(dateText: string) {
  const [year, month, day] = cleanDateOnly(dateText).split("-").map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function getMonthKey(dateText: string) {
  return cleanDateOnly(dateText).slice(0, 7);
}

function getMonthBounds(monthKey: string) {
  const [year, month] = monthKey.split("-").map(Number);
  const end = new Date(year, month, 0, 12, 0, 0, 0);

  return {
    start: `${monthKey}-01`,
    end: toDateOnly(end),
  };
}

function countDatesByMonth(dates: string[]) {
  return dates.reduce<Record<string, number>>((counts, date) => {
    const monthKey = getMonthKey(date);
    counts[monthKey] = (counts[monthKey] || 0) + 1;
    return counts;
  }, {});
}

function getDefaultRepeatUntil(startDate: string, repeatType: RepeatType) {
  const date = parseDateOnly(startDate);

  if (repeatType === "daily") date.setDate(date.getDate() + 1);
  if (repeatType === "weekly") date.setDate(date.getDate() + 7);
  if (repeatType === "biweekly") date.setDate(date.getDate() + 14);
  if (repeatType === "monthly") date.setMonth(date.getMonth() + 1);

  return toDateOnly(date);
}

function generateRecurringDates(
  startDate: string,
  repeatType: RepeatType,
  repeatUntil: string,
) {
  if (repeatType === "none") return [startDate];

  const dates: string[] = [];
  const current = parseDateOnly(startDate);
  const end = parseDateOnly(repeatUntil);

  while (current <= end && dates.length < 52) {
    dates.push(toDateOnly(current));

    if (repeatType === "daily") current.setDate(current.getDate() + 1);
    if (repeatType === "weekly") current.setDate(current.getDate() + 7);
    if (repeatType === "biweekly") current.setDate(current.getDate() + 14);
    if (repeatType === "monthly") current.setMonth(current.getMonth() + 1);
  }

  return dates;
}

function getClientDisplayName(client: any) {
  const name = String(client?.name || "").trim();

  if (name && name !== "New Client") return name;

  return (
    String(client?.phone || "").trim() ||
    String(client?.email || "").trim() ||
    "New Client"
  );
}

function isUsableService(service: unknown): service is Service {
  return !!service && typeof service === "object";
}

function routeParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return typeof value === "string" ? value : "";
}
export function useBookAppointmentForm() {
  const router = useRouter();
  const params = useLocalSearchParams();

  const appointmentId = routeParam(params.appointmentId);
  const blockId = routeParam(params.blockId);
  const routeMode = routeParam(params.mode);

  const appointmentDateParam = routeParam(params.appointmentDate);
  const appointmentTimeParam = toDisplayTime(
    routeParam(params.appointmentTime),
    "09:00",
  );

  const isEditMode = routeMode === "edit" || routeParam(params.editMode) === "true";

  const [use24Hour, setUse24Hour] = useState(false);
  const [calendarIntervalMinutes, setCalendarIntervalMinutes] = useState(30);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editLoaded, setEditLoaded] = useState(false);

  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [userId, setUserId] = useState("");

  const [entryType, setEntryType] = useState<EntryType>(
    blockId ? "blocked_time" : "appointment",
  );

  const [selectedClient, setSelectedClient] = useState("");
  const [existingAppointmentClientId, setExistingAppointmentClientId] =
    useState("");
  const [existingAppointmentClientName, setExistingAppointmentClientName] =
    useState("");
  const [selectedServices, setSelectedServices] = useState<Service[]>([]);
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [finalPrice, setFinalPrice] = useState("");
  const [title, setTitle] = useState("");

  const [appointmentDate, setAppointmentDate] = useState(
    cleanDateOnly(appointmentDateParam || todayIso()),
  );

  const [startTime, setStartTime] = useState(appointmentTimeParam || "09:00");
  const [endTime, setEndTime] = useState("09:30");
  const [allDay, setAllDay] = useState(false);
  const [repeatType, setRepeatType] = useState<RepeatType>("none");
  const [repeatUntil, setRepeatUntil] = useState(todayIso());
  const [endTimeManuallyChanged, setEndTimeManuallyChanged] = useState(false);

  const [showQuickClient, setShowQuickClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");

  const [showQuickService, setShowQuickService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServicePrice, setNewServicePrice] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("30");

  const totalDuration = useMemo(
    () => getTotalDuration(selectedServices),
    [selectedServices],
  );

  const totalPrice = useMemo(
    () => getTotalPrice(selectedServices),
    [selectedServices],
  );

  const clientDropdownData = useMemo(
    () => [
      { label: "+ New Client", value: "new_client" },
      ...clients.map((client) => ({
        label: getClientDisplayName(client),
        value: normalizeId(client.id),
      })),
    ],
    [clients],
  );

  const serviceDropdownData = useMemo(
    () => [
      { label: "+ New Service", value: "new_service" },
      ...services.map((service) => ({
        label: `${service.name || "Unnamed Service"} • ${Number(
          service.duration_minutes || 0,
        )} min • ${formatMoney(Number(service.price || 0))}`,
        value: normalizeId(service.id),
      })),
    ],
    [services],
  );

  async function loadCalendarPreferences() {
    const preferences = await getCalendarPreferences();
    setUse24Hour(preferences.timeFormat === "24h");
    setCalendarIntervalMinutes(preferences.intervalMinutes);
  }

  async function fetchBaseData() {
    setLoading(true);
    setEditLoaded(false);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

      setUserId(currentUserId || "");

      if (!currentUserId) {
        Alert.alert("Login Required", "Please sign in again.");
        return;
      }

      const [clientsResult, servicesResult] = await Promise.all([
        supabase
          .from("clients")
          .select("*")
          .eq("user_id", currentUserId)
          .is("archived_at", null)
          .order("name"),
        supabase
          .from("services")
          .select("*")
          .eq("user_id", currentUserId)
          .order("name"),
      ]);

      setClients(
        (clientsResult.data || []).map((client: any) => ({
          ...client,
          id: normalizeId(client.id),
        })),
      );

      setServices(
        (servicesResult.data || []).map((service: any) => ({
          ...service,
          id: normalizeId(service.id),
        })),
      );
    } finally {
      setLoading(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      fetchBaseData();
      void loadCalendarPreferences();
    }, []),
  );

  useEffect(() => {
    if (loading || editLoaded) return;

    if (appointmentId) {
      loadAppointmentForEdit(appointmentId).finally(() => setEditLoaded(true));
      return;
    }

    if (blockId) {
      loadBlockForEdit(blockId).finally(() => setEditLoaded(true));
      return;
    }

    const defaultStartTime = appointmentTimeParam || "09:00";

    setEntryType("appointment");
    setAppointmentDate(cleanDateOnly(appointmentDateParam || todayIso()));
    setStartTime(defaultStartTime);
    setEndTime(addMinutesToTime(defaultStartTime, calendarIntervalMinutes));
    setEndTimeManuallyChanged(false);
    setSelectedClient("");
    setExistingAppointmentClientId("");
    setExistingAppointmentClientName("");
    setSelectedServices([]);
    setAppointmentNotes("");
    setFinalPrice("");
    setTitle("");
    setAllDay(false);
    setRepeatType("none");
    setRepeatUntil(cleanDateOnly(appointmentDateParam || todayIso()));
    setEditLoaded(true);
  }, [
    loading,
    editLoaded,
    appointmentId,
    blockId,
    appointmentDateParam,
    appointmentTimeParam,
    calendarIntervalMinutes,
  ]);

  useEffect(() => {
    if (entryType !== "appointment") return;
    if (endTimeManuallyChanged) return;

    setEndTime(calculateEndTime(startTime, totalDuration || calendarIntervalMinutes));
  }, [
    entryType,
    startTime,
    totalDuration,
    endTimeManuallyChanged,
    calendarIntervalMinutes,
  ]);

  useEffect(() => {
    if (repeatType === "none") return;

    setRepeatUntil(
      getDefaultRepeatUntil(cleanDateOnly(appointmentDate), repeatType),
    );
  }, [appointmentDate, repeatType]);

  useEffect(() => {
    if (entryType === "appointment") return;
    if (allDay) return;

    setEndTime(addMinutesToTime(startTime, calendarIntervalMinutes));
  }, [entryType, allDay, startTime, calendarIntervalMinutes]);

  async function loadBlockForEdit(id: string) {
    const { data, error } = await supabase
      .from("blocked_times")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Calendar entry not found.");
      return;
    }

    const cleanStart = toDisplayTime(data.start_time, "09:00");
    const cleanEnd = toDisplayTime(data.end_time, "09:30");
    const isAllDayBlock =
      String(data.start_time).startsWith("00:00") &&
      String(data.end_time).startsWith("23:45");

    setEntryType(normalizeEntryType(data.block_type));
    setSelectedClient("");
    setExistingAppointmentClientId("");
    setExistingAppointmentClientName("");
    setSelectedServices([]);
    setAppointmentNotes("");
    setFinalPrice("");
    setAppointmentDate(cleanDateOnly(data.block_date));
    setStartTime(cleanStart);
    setEndTime(cleanEnd);
    setTitle(data.title || "");
    setAllDay(isAllDayBlock);
  }

  async function loadAppointmentForEdit(id: string) {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Appointment not found.");
      return;
    }

    const matchedServices = getAppointmentServices(data, services);

    const clientId = normalizeId(data.client_id);
    const matchedClient = clients.find(
      (client) => normalizeId(client.id) === clientId,
    );

    setEntryType("appointment");
    setSelectedClient(matchedClient ? normalizeId(matchedClient.id) : "");
    setExistingAppointmentClientId(clientId);
    setExistingAppointmentClientName(data.client_name || "");
    setSelectedServices(matchedServices);
    setTitle("");
    setAppointmentDate(cleanDateOnly(data.appointment_date));
    setStartTime(toDisplayTime(data.appointment_time, "09:00"));
    setEndTime(toDisplayTime(data.end_time || data.appointment_time, "09:30"));
    setEndTimeManuallyChanged(true);
    setAllDay(false);
    setRepeatType("none");
    setRepeatUntil(cleanDateOnly(data.appointment_date));
    setAppointmentNotes(data.appointment_notes || "");
    setFinalPrice(
      data.final_price !== null && data.final_price !== undefined
        ? String(data.final_price)
        : "",
    );
  }

  function addServiceToAppointment(service: Service) {
    if (!isUsableService(service)) {
      Alert.alert("Service Error", "Select a valid service and try again.");
      return;
    }

    const cleanService = { ...service, id: normalizeId(service.id) };
    setSelectedServices((current) => [...current, cleanService]);
  }

  function removeSelectedService(indexToRemove: number) {
    setSelectedServices((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
  }

  async function saveQuickClient() {
    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData.user?.id;

    if (!currentUserId) {
      Alert.alert("Login Required", "Please sign in to add a client.");
      return;
    }

    if (
      !newClientName.trim() &&
      !newClientPhone.trim() &&
      !newClientEmail.trim()
    ) {
      Alert.alert("Missing Info", "Add a name, phone, or email.");
      return;
    }

    if (
      !canUseFeature("moreClients") &&
      clients.length >= FREE_TIER_LIMITS.clients
    ) {
      Alert.alert(
        "Schedova Pro",
        `Free includes up to ${FREE_TIER_LIMITS.clients} clients. Upgrade to add more.`,
      );
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .insert({
        user_id: currentUserId,
        name:
          newClientName.trim() ||
          newClientPhone.trim() ||
          newClientEmail.trim() ||
          "New Client",
        phone: newClientPhone.trim() || null,
        email: newClientEmail.trim() || null,
      })
      .select("*")
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Could not add client.");
      return;
    }

    const cleanClient = { ...data, id: normalizeId(data.id) };

    setClients((current) =>
      [...current, cleanClient].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      ),
    );

    setSelectedClient(cleanClient.id);
    setNewClientName("");
    setNewClientPhone("");
    setNewClientEmail("");
    setShowQuickClient(false);
  }

  async function saveQuickService() {
    const { data: userData } = await supabase.auth.getUser();
    const currentUserId = userData.user?.id;

    if (!currentUserId) {
      Alert.alert("Login Required", "Please sign in to add a service.");
      return;
    }

    if (!newServiceName.trim()) {
      Alert.alert("Missing Info", "Enter a service name.");
      return;
    }

    if (
      !canUseFeature("moreServices") &&
      services.length >= FREE_TIER_LIMITS.services
    ) {
      Alert.alert(
        "Schedova Pro",
        `Free includes up to ${FREE_TIER_LIMITS.services} services. Upgrade to add more.`,
      );
      return;
    }

    const priceNumber = Number(newServicePrice);
    const durationNumber = Number(newServiceDuration);

    const { data, error } = await supabase
      .from("services")
      .insert({
        user_id: currentUserId,
        name: newServiceName.trim(),
        price: Number.isFinite(priceNumber) ? priceNumber : 0,
        duration_minutes: Number.isFinite(durationNumber) ? durationNumber : 30,
      })
      .select("*")
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Could not add service.");
      return;
    }

    const cleanService = { ...data, id: normalizeId(data.id) };

    setServices((current) =>
      [...current, cleanService].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      ),
    );

    addServiceToAppointment(cleanService);
    setNewServiceName("");
    setNewServicePrice("");
    setNewServiceDuration("30");
    setShowQuickService(false);
  }

  function navigateAfterSave() {
    try {
      router.dismissTo("/dashboard" as any);
    } catch (error) {
      console.log("BOOKING NAVIGATION FALLBACK:", error);
      router.replace("/dashboard" as any);
    }
  }

  async function saveEntry() {
    if (saving) return false;
    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const currentUserId = userData.user?.id;

      if (!currentUserId) {
        Alert.alert("Login Required", "You must be logged in.");
        return false;
      }

      const safeDate = cleanDateOnly(appointmentDate);

      const saved =
        entryType === "appointment"
          ? await saveAppointment(currentUserId, safeDate)
          : await saveCalendarBlock(currentUserId, safeDate);

      if (!saved) return false;

      navigateAfterSave();
      return true;
    } catch (error) {
      console.log("SAVE ENTRY CRASH:", error);

      Alert.alert("Save Error", "Something went wrong while saving.");
      return false;
    } finally {
      setSaving(false);
    }
  }


  async function scheduleAppointmentSideEffects(
    savedAppointments: SavedAppointmentForSideEffects[],
    messageType: "confirmation" | "update",
  ) {
    if (!savedAppointments.length) return;

    if (canUseFeature("smartReminders")) {
      await Promise.all(
        savedAppointments.map((appointment) =>
          scheduleAppointmentReminder({
            appointmentId: appointment.id,
            clientName: appointment.client_name,
            appointmentDate: appointment.appointment_date,
            appointmentTime: appointment.appointment_time,
          }),
        ),
      );
    }

    const firstAppointment = savedAppointments[0];

    if (firstAppointment?.id && canUseFeature("smsAutomation")) {
      void sendAppointmentSmsNonBlocking(firstAppointment.id, messageType);
    }
  }

  async function canCreateAppointmentsWithinFreeLimit(
    currentUserId: string,
    dates: string[],
  ) {
    if (canUseFeature("moreAppointments")) return true;

    const newAppointmentsByMonth = countDatesByMonth(dates);

    for (const [monthKey, newCount] of Object.entries(newAppointmentsByMonth)) {
      const { start, end } = getMonthBounds(monthKey);

      const { data, error } = await supabase
        .from("appointments")
        .select("id")
        .eq("user_id", currentUserId)
        .gte("appointment_date", start)
        .lte("appointment_date", end)
        .neq("status", "canceled");

      if (error) {
        Alert.alert("Error", error.message);
        return false;
      }

      const existingCount = (data || []).length;

      if (existingCount + newCount > FREE_TIER_LIMITS.appointmentsPerMonth) {
        Alert.alert(
          "Schedova Pro",
          `Free includes up to ${FREE_TIER_LIMITS.appointmentsPerMonth} appointments per month. Upgrade to book more.`,
        );
        return false;
      }
    }

    return true;
  }

  async function saveAppointment(currentUserId: string, safeDate: string) {
    const cleanSelectedServices = selectedServices.filter(isUsableService);

    if (cleanSelectedServices.length === 0) {
      Alert.alert("Missing Info", "Select at least one service.");
      return false;
    }

    if (
      repeatType !== "none" &&
      parseDateOnly(repeatUntil) < parseDateOnly(safeDate)
    ) {
      Alert.alert(
        "Repeat Error",
        "Repeat until date must be after the start date.",
      );
      return false;
    }

    const selectedClientRecord = clients.find(
      (client) => normalizeId(client.id) === normalizeId(selectedClient),
    );
    const preservedClientName = String(existingAppointmentClientName).trim();
    const preservedClientId = normalizeId(existingAppointmentClientId);
    const shouldPreserveArchivedClient =
      isEditMode && !selectedClientRecord && !!preservedClientName;

    const finalEndTime = endTimeManuallyChanged
      ? toDisplayTime(endTime, "09:30")
      : calculateEndTime(startTime, totalDuration || calendarIntervalMinutes);

    const newStartTime = toSqlTime(startTime, "09:00:00");
    const newEndTime = toSqlTime(finalEndTime, "09:30:00");

    if (timeToMinutes(newEndTime) <= timeToMinutes(newStartTime)) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return false;
    }

    const recurringDates = generateRecurringDates(
      safeDate,
      repeatType,
      cleanDateOnly(repeatUntil || safeDate),
    );

    if (recurringDates.length === 0) {
      Alert.alert("Date Error", "Choose a valid appointment date.");
      return false;
    }

    if (
      !isEditMode &&
      !(await canCreateAppointmentsWithinFreeLimit(
        currentUserId,
        recurringDates,
      ))
    ) {
      return false;
    }

    for (const date of recurringDates) {
      const { data: existingAppointments, error: existingError } =
        await supabase
          .from("appointments")
          .select("id, appointment_date, appointment_time, end_time, status")
          .eq("user_id", currentUserId)
          .neq("status", "canceled");

      if (existingError) {
        Alert.alert("Error", "Could not check appointment availability.");
        return false;
      }

      const newStartMinutes = timeToMinutes(newStartTime);
      const newEndMinutes = timeToMinutes(newEndTime);

      const hasOverlap =
        existingAppointments?.some((appt: any) => {
          if (isEditMode && appointmentId && appt.id === appointmentId) {
            return false;
          }

          if (cleanDateOnly(appt.appointment_date) !== cleanDateOnly(date)) {
            return false;
          }

          const existingStartMinutes = timeToMinutes(appt.appointment_time);
          const existingEndMinutes = timeToMinutes(appt.end_time);

          return (
            existingStartMinutes < newEndMinutes &&
            existingEndMinutes > newStartMinutes
          );
        }) ?? false;

      if (hasOverlap) {
        Alert.alert(
          "Time Already Booked",
          `There is already an appointment on ${date} during this time.`,
        );
        return false;
      }

      const { data: blockedTimes, error: blockedError } = await supabase
        .from("blocked_times")
        .select("id, start_time, end_time")
        .eq("user_id", currentUserId)
        .eq("block_date", date)
        .lt("start_time", newEndTime)
        .gt("end_time", newStartTime);

      if (blockedError) {
        Alert.alert("Error", "Could not check blocked times.");
        return false;
      }

      if (blockedTimes && blockedTimes.length > 0) {
        Alert.alert(
          "Blocked Time",
          `The appointment on ${date} falls inside a blocked period.`,
        );
        return false;
      }
    }

    const finalPriceNumber = Number(finalPrice);

    const baseAppointmentData = {
      user_id: currentUserId,
      client_id:
        selectedClient || (shouldPreserveArchivedClient ? preservedClientId : null),
      client_name: selectedClientRecord
        ? getClientDisplayName(selectedClientRecord)
        : shouldPreserveArchivedClient
          ? preservedClientName
          : "New Client",
      service_id: cleanSelectedServices[0]?.id
        ? normalizeId(cleanSelectedServices[0].id)
        : null,

      service_ids: cleanSelectedServices
        .map((service) => normalizeId(service.id))
        .filter(Boolean),
      service_snapshots: createServiceSnapshots(cleanSelectedServices),
      appointment_time: newStartTime,
      end_time: newEndTime,
      appointment_notes: appointmentNotes.trim() || null,
      final_price: finalPrice.trim()
        ? Number.isFinite(finalPriceNumber)
          ? finalPriceNumber
          : 0
        : null,
      status: "scheduled",
    };

    if (isEditMode && appointmentId) {
      const { error } = await supabase
        .from("appointments")
        .update({
          ...baseAppointmentData,
          appointment_date: safeDate,
        })
        .eq("id", appointmentId)
        .eq("user_id", currentUserId);

      if (error) {
        Alert.alert("Error", error.message);
        return false;
      }

      await scheduleAppointmentSideEffects(
        [
          {
            id: appointmentId,
            appointment_date: safeDate,
            appointment_time: newStartTime,
            client_name: baseAppointmentData.client_name,
          },
        ],
        "update",
      );

      return true;
    }

    const appointmentsToInsert = recurringDates.map((date) => ({
      ...baseAppointmentData,
      appointment_date: date,
    }));

    const uniqueAppointments = appointmentsToInsert.filter(
      (appointment, index, self) =>
        index ===
        self.findIndex(
          (a) =>
            a.appointment_date === appointment.appointment_date &&
            a.appointment_time === appointment.appointment_time,
        ),
    );

    const { data: insertedAppointments, error } = await supabase
      .from("appointments")
      .insert(uniqueAppointments)
      .select("id, appointment_date, appointment_time, client_name");

    if (error) {
      Alert.alert("Error", error.message);
      return false;
    }

    await scheduleAppointmentSideEffects(
      (insertedAppointments || []) as SavedAppointmentForSideEffects[],
      "confirmation",
    );

    return true;
  }

  async function saveCalendarBlock(currentUserId: string, safeDate: string) {
    if (!canUseFeature("customBusinessHours")) {
      Alert.alert(
        "Schedova Pro",
        "Custom business hours and blocked time are Pro features.",
      );
      return false;
    }

    const safeStartTime = allDay
      ? "00:00:00"
      : toSqlTime(startTime, "09:00:00");

    const safeEndTime = allDay ? "23:45:00" : toSqlTime(endTime, "10:00:00");

    if (!allDay && timeToMinutes(safeEndTime) <= timeToMinutes(safeStartTime)) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return false;
    }

    const appointmentsResult = await supabase
      .from("appointments")
      .select("*")
      .eq("user_id", currentUserId)
      .eq("appointment_date", safeDate)
      .neq("status", "canceled");

    if (appointmentsResult.error) {
      Alert.alert("Error", appointmentsResult.error.message);
      return false;
    }

    const existingAppointments = appointmentsResult.data || [];

    if (allDay && existingAppointments.length > 0) {
      Alert.alert(
        "Blocked Time Conflict",
        "This day already has appointments scheduled.",
      );
      return false;
    }

    if (!allDay) {
      const blockStartMinutes = timeToMinutes(safeStartTime);
      const blockEndMinutes = timeToMinutes(safeEndTime);

      const overlapsAppointment = existingAppointments.some((appointment) => {
        const apptStartMinutes = timeToMinutes(appointment.appointment_time);
        const apptEndMinutes = timeToMinutes(appointment.end_time);

        return (
          blockStartMinutes < apptEndMinutes &&
          blockEndMinutes > apptStartMinutes
        );
      });

      if (overlapsAppointment) {
        Alert.alert(
          "Blocked Time Conflict",
          "This blocked time overlaps an appointment.",
        );
        return false;
      }
    }

    const { data: overlappingBlocks, error: blockConflictError } =
      await supabase
        .from("blocked_times")
        .select("id")
        .eq("user_id", currentUserId)
        .eq("block_date", safeDate)
        .lt("start_time", safeEndTime)
        .gt("end_time", safeStartTime);

    if (blockConflictError) {
      Alert.alert("Error", blockConflictError.message);
      return false;
    }

    const hasOverlappingBlock =
      overlappingBlocks?.some((block) => block.id !== blockId) ?? false;

    if (hasOverlappingBlock) {
      Alert.alert("Conflict", "This time overlaps an existing blocked time.");
      return false;
    }

    const blockData = {
      user_id: currentUserId,
      title: title.trim() || blockTitleFor(entryType),
      block_date: safeDate,
      start_time: safeStartTime,
      end_time: safeEndTime,
      block_type: entryType === "blocked_time" ? "blocked_time" : entryType,
      notes: null,
    };

    if (blockId) {
      const { error } = await supabase
        .from("blocked_times")
        .update(blockData)
        .eq("id", blockId)
        .eq("user_id", currentUserId);

      if (error) {
        Alert.alert("Error", error.message);
        return false;
      }

      return true;
    }

    const { error } = await supabase.from("blocked_times").insert(blockData);

    if (error) {
      Alert.alert("Error", error.message);
      return false;
    }

    return true;
  }

  return {
    appointmentId,
    blockId,
    isEditMode,
    use24Hour,
    calendarIntervalMinutes,
    loading,
    saving,
    userId,

    repeatType,
    setRepeatType,
    repeatUntil,
    setRepeatUntil,

    entryType,
    setEntryType,
    selectedClient,
    setSelectedClient,
    selectedServices,
    title,
    setTitle,
    appointmentNotes,
    setAppointmentNotes,
    finalPrice,
    setFinalPrice,
    appointmentDate,
    setAppointmentDate,
    startTime,
    setStartTime,
    endTime,
    setEndTime,
    allDay,
    setAllDay,
    setEndTimeManuallyChanged,

    totalPrice,
    clientDropdownData,
    serviceDropdownData,
    services,

    showQuickClient,
    setShowQuickClient,
    newClientName,
    setNewClientName,
    newClientPhone,
    setNewClientPhone,
    newClientEmail,
    setNewClientEmail,
    saveQuickClient,

    showQuickService,
    setShowQuickService,
    newServiceName,
    setNewServiceName,
    newServicePrice,
    setNewServicePrice,
    newServiceDuration,
    setNewServiceDuration,
    saveQuickService,

    addServiceToAppointment,
    removeSelectedService,
    saveEntry,
  };
}
