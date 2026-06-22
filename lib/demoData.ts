import { createServiceSnapshots } from "./appointmentServices";
import { normalizePhoneForSms } from "./phoneNumbers";
import { supabase } from "./supabase";

type DemoClientInput = {
  name: string;
  phone: string;
  email: string;
  notes: string | null;
  client_tag: "New" | "Regular" | "VIP";
  sms_opt_in: boolean;
};

type DemoServiceInput = {
  name: string;
  price: number;
  duration_minutes: number;
  color_hex: string;
};

type DemoRecord = {
  id: string;
  name: string;
  price?: number | null;
  duration_minutes?: number | null;
  color_hex?: string | null;
};

export type DemoScreenshotSeedResult = {
  clients: number;
  services: number;
  appointments: number;
  today: string;
  tomorrow: string;
};

const DEMO_CLIENTS: DemoClientInput[] = [
  {
    name: "Ava Johnson",
    phone: "5551234567",
    email: "ava.johnson@example.com",
    notes: null,
    client_tag: "Regular",
    sms_opt_in: false,
  },
  {
    name: "Mia Carter",
    phone: "(555) 234-6789",
    email: "mia.carter@example.com",
    notes: "Prefers text updates and a soft brow shape.",
    client_tag: "VIP",
    sms_opt_in: true,
  },
  {
    name: "Jordan Lee",
    phone: "555 345 7890",
    email: "jordan.lee@example.com",
    notes: null,
    client_tag: "New",
    sms_opt_in: false,
  },
];

const DEMO_SERVICES: DemoServiceInput[] = [
  {
    name: "Haircut",
    price: 35,
    duration_minutes: 45,
    color_hex: "#0F766E",
  },
  {
    name: "Beard Trim",
    price: 20,
    duration_minutes: 20,
    color_hex: "#2563EB",
  },
  {
    name: "Eyebrow Wax",
    price: 15,
    duration_minutes: 15,
    color_hex: "#DB2777",
  },
  {
    name: "Tattoo Consultation",
    price: 50,
    duration_minutes: 60,
    color_hex: "#7C3AED",
  },
];

export function isDemoScreenshotModeAvailable() {
  return __DEV__ || process.env.EXPO_PUBLIC_SCHEDOVA_DEMO_MODE === "true";
}

function toDateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0",
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: Date, days: number) {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
}

function addMinutesToSqlTime(time: string, minutesToAdd: number) {
  const [hourText, minuteText] = time.split(":");
  const date = new Date(2000, 0, 1, Number(hourText), Number(minuteText), 0, 0);

  date.setMinutes(date.getMinutes() + minutesToAdd);

  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}:00`;
}

function getByName(records: DemoRecord[], name: string) {
  const record = records.find((item) => item.name === name);

  if (!record) {
    throw new Error(`Could not prepare demo data for ${name}.`);
  }

  return record;
}

async function upsertDemoClient(userId: string, input: DemoClientInput) {
  const { data: existingClients, error: selectError } = await supabase
    .from("clients")
    .select("id")
    .eq("user_id", userId)
    .eq("name", input.name)
    .is("archived_at", null)
    .limit(1);

  if (selectError) throw new Error(selectError.message);

  const now = new Date().toISOString();
  const payload = {
    user_id: userId,
    name: input.name,
    phone: normalizePhoneForSms(input.phone, "US"),
    email: input.email,
    notes: input.notes,
    birthday: null,
    rebooking_weeks: 6,
    client_tag: input.client_tag,
    sms_opt_in: input.sms_opt_in,
    sms_opt_in_at: input.sms_opt_in ? now : null,
    sms_opt_in_source: input.sms_opt_in ? "screenshot_demo" : null,
  };

  if (existingClients?.[0]?.id) {
    const { data, error } = await supabase
      .from("clients")
      .update(payload)
      .eq("id", existingClients[0].id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as DemoRecord;
  }

  const { data, error } = await supabase
    .from("clients")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as DemoRecord;
}

async function upsertDemoService(userId: string, input: DemoServiceInput) {
  const { data: existingServices, error: selectError } = await supabase
    .from("services")
    .select("id")
    .eq("user_id", userId)
    .eq("name", input.name)
    .limit(1);

  if (selectError) throw new Error(selectError.message);

  const payload = {
    user_id: userId,
    name: input.name,
    price: input.price,
    duration_minutes: input.duration_minutes,
    color_hex: input.color_hex,
  };

  if (existingServices?.[0]?.id) {
    const { data, error } = await supabase
      .from("services")
      .update(payload)
      .eq("id", existingServices[0].id)
      .eq("user_id", userId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return data as DemoRecord;
  }

  const { data, error } = await supabase
    .from("services")
    .insert(payload)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data as DemoRecord;
}

function buildAppointment({
  userId,
  client,
  services,
  date,
  time,
  notes,
}: {
  userId: string;
  client: DemoRecord;
  services: DemoRecord[];
  date: string;
  time: string;
  notes: string | null;
}) {
  const duration = services.reduce(
    (total, service) => total + Number(service.duration_minutes || 0),
    0,
  );
  const price = services.reduce(
    (total, service) => total + Number(service.price || 0),
    0,
  );
  const serviceIds = services.map((service) => service.id);

  return {
    user_id: userId,
    client_id: client.id,
    client_name: client.name,
    service_id: serviceIds[0],
    service_ids: serviceIds,
    service_snapshots: createServiceSnapshots(services),
    appointment_date: date,
    appointment_time: `${time}:00`,
    end_time: addMinutesToSqlTime(time, duration),
    duration_minutes: duration,
    appointment_notes: notes,
    final_price: price,
    status: "scheduled",
  };
}

export async function seedDemoScreenshotData(): Promise<DemoScreenshotSeedResult> {
  if (!isDemoScreenshotModeAvailable()) {
    throw new Error("Screenshot demo mode is disabled for this build.");
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) throw new Error(userError.message);

  const userId = userData.user?.id;

  if (!userId) {
    throw new Error("Please sign in before loading screenshot demo data.");
  }

  const [clients, services] = await Promise.all([
    Promise.all(DEMO_CLIENTS.map((client) => upsertDemoClient(userId, client))),
    Promise.all(
      DEMO_SERVICES.map((service) => upsertDemoService(userId, service)),
    ),
  ]);

  const today = toDateOnly(new Date());
  const tomorrow = toDateOnly(addDays(new Date(), 1));
  const demoClientNames = DEMO_CLIENTS.map((client) => client.name);

  const { error: deleteError } = await supabase
    .from("appointments")
    .delete()
    .eq("user_id", userId)
    .in("client_name", demoClientNames)
    .in("appointment_date", [today, tomorrow]);

  if (deleteError) throw new Error(deleteError.message);

  const appointments = [
    buildAppointment({
      userId,
      client: getByName(clients, "Ava Johnson"),
      services: [getByName(services, "Haircut")],
      date: today,
      time: "09:00",
      notes: "Fresh trim before the weekend.",
    }),
    buildAppointment({
      userId,
      client: getByName(clients, "Mia Carter"),
      services: [
        getByName(services, "Haircut"),
        getByName(services, "Eyebrow Wax"),
      ],
      date: today,
      time: "11:00",
      notes: "Multi-service appointment with SMS consent on file.",
    }),
    buildAppointment({
      userId,
      client: getByName(clients, "Jordan Lee"),
      services: [getByName(services, "Beard Trim")],
      date: tomorrow,
      time: "10:30",
      notes: null,
    }),
    buildAppointment({
      userId,
      client: getByName(clients, "Ava Johnson"),
      services: [getByName(services, "Tattoo Consultation")],
      date: tomorrow,
      time: "14:00",
      notes: "Review placement and size options.",
    }),
  ];

  const { data: insertedAppointments, error: insertError } = await supabase
    .from("appointments")
    .insert(appointments)
    .select("id");

  if (insertError) throw new Error(insertError.message);

  return {
    clients: clients.length,
    services: services.length,
    appointments: insertedAppointments?.length || appointments.length,
    today,
    tomorrow,
  };
}
