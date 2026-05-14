import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Picker } from "@react-native-picker/picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dropdown } from "react-native-element-dropdown";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const TIMES = [
  "00:00",
  "00:15",
  "00:30",
  "00:45",
  "01:00",
  "01:15",
  "01:30",
  "01:45",
  "02:00",
  "02:15",
  "02:30",
  "02:45",
  "03:00",
  "03:15",
  "03:30",
  "03:45",
  "04:00",
  "04:15",
  "04:30",
  "04:45",
  "05:00",
  "05:15",
  "05:30",
  "05:45",
  "06:00",
  "06:15",
  "06:30",
  "06:45",
  "07:00",
  "07:15",
  "07:30",
  "07:45",
  "08:00",
  "08:15",
  "08:30",
  "08:45",
  "09:00",
  "09:15",
  "09:30",
  "09:45",
  "10:00",
  "10:15",
  "10:30",
  "10:45",
  "11:00",
  "11:15",
  "11:30",
  "11:45",
  "12:00",
  "12:15",
  "12:30",
  "12:45",
  "13:00",
  "13:15",
  "13:30",
  "13:45",
  "14:00",
  "14:15",
  "14:30",
  "14:45",
  "15:00",
  "15:15",
  "15:30",
  "15:45",
  "16:00",
  "16:15",
  "16:30",
  "16:45",
  "17:00",
  "17:15",
  "17:30",
  "17:45",
  "18:00",
  "18:15",
  "18:30",
  "18:45",
  "19:00",
  "19:15",
  "19:30",
  "19:45",
  "20:00",
  "20:15",
  "20:30",
  "20:45",
  "21:00",
  "21:15",
  "21:30",
  "21:45",
  "22:00",
  "22:15",
  "22:30",
  "22:45",
  "23:00",
  "23:15",
  "23:30",
  "23:45",
];

function todayIso() {
  return new Date().toISOString().split("T")[0];
}

function toSqlTime(value: string, fallback: string) {
  if (!value) return fallback;
  if (value.length === 5) return `${value}:00`;
  return value.slice(0, 8);
}

function calculateEndTime(startTime: string, durationMinutes: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const date = new Date();

  date.setHours(hours || 9, minutes || 0, 0, 0);
  date.setMinutes(date.getMinutes() + durationMinutes);

  return date.toTimeString().slice(0, 5);
}

function formatBlockTitle(type: string) {
  switch (type) {
    case "vacation":
      return "Vacation";
    case "personal":
      return "Personal Event";
    case "blocked":
      return "Blocked Time";
    default:
      return "Calendar Block";
  }
}

export default function BookAppointmentScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { colors } = useAppTheme();

  const appointmentId =
    typeof params.appointmentId === "string" ? params.appointmentId : "";
  const blockId = typeof params.blockId === "string" ? params.blockId : "";
  const editMode = params.editMode === "true";

  const [entryType, setEntryType] = useState("appointment");
  const [clients, setClients] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);

  const [selectedClient, setSelectedClient] = useState("");
  const [selectedService, setSelectedService] = useState("");

  const [showQuickClient, setShowQuickClient] = useState(false);
  const [newClientName, setNewClientName] = useState("");
  const [newClientPhone, setNewClientPhone] = useState("");
  const [newClientEmail, setNewClientEmail] = useState("");

  const [showQuickService, setShowQuickService] = useState(false);
  const [newServiceName, setNewServiceName] = useState("");
  const [newServicePrice, setNewServicePrice] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("30");

  const [title, setTitle] = useState("");
  const [appointmentDate, setAppointmentDate] = useState(
    String(params.appointmentDate || todayIso()),
  );
  const [startTime, setStartTime] = useState(
    String(params.appointmentTime || "09:00"),
  );
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [notes, setNotes] = useState("");

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState<boolean>(false);

  useFocusEffect(
    useCallback(() => {
      fetchData();

      return () => {
        setShowQuickClient(false);
        setShowQuickService(false);
        setShowDatePicker(false);
        setSaving(false);
      };
    }, []),
  );

  useEffect(() => {
    if (!appointmentId || clients.length === 0) return;
    loadAppointmentForEdit();
  }, [appointmentId, clients.length]);

  useEffect(() => {
    if (!blockId) return;
    loadBlockForEdit();
  }, [blockId]);

  useEffect(() => {
    if (!appointmentId && !blockId) {
      setEntryType("appointment");
      setSelectedClient("");
      setSelectedService("");
      setTitle("");
      setNotes("");
      setAllDay(false);
      setStartTime(String(params.appointmentTime || "09:00"));
      setEndTime("10:00");
      setAppointmentDate(String(params.appointmentDate || todayIso()));
    }
  }, [appointmentId, blockId]);

  useEffect(() => {
    if (entryType !== "appointment") {
      setSelectedClient("");
      setSelectedService("");
      if (!endTime) setEndTime("10:00");
    }

    if (entryType === "appointment") {
      setTitle("");
      setAllDay(false);
      setEndTime("10:00");
    }
  }, [entryType]);

  async function fetchData() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    setIsLoggedIn(Boolean(userId));

    if (!userId) return;

    const clientsResult = await supabase
      .from("clients")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    const servicesResult = await supabase
      .from("services")
      .select("*")
      .eq("user_id", userId)
      .order("name");

    setClients(clientsResult.data || []);
    setServices(servicesResult.data || []);
  }

  async function loadAppointmentForEdit() {
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .eq("id", appointmentId)
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Appointment not found.");
      return;
    }

    setEntryType("appointment");
    setAppointmentDate(data.appointment_date || todayIso());
    setStartTime(String(data.appointment_time || "09:00").slice(0, 5));
    setEndTime(String(data.end_time || "10:00").slice(0, 5));
    setSelectedService(data.service_id || "");
    setNotes(data.appointment_notes || "");

    const matchedClient = clients.find(
      (client) =>
        String(client.name || "")
          .trim()
          .toLowerCase() ===
        String(data.client_name || "")
          .trim()
          .toLowerCase(),
    );

    setSelectedClient(matchedClient?.id || "");
  }

  async function loadBlockForEdit() {
    const { data, error } = await supabase
      .from("blocked_times")
      .select("*")
      .eq("id", blockId)
      .single();

    if (error || !data) {
      Alert.alert("Error", error?.message || "Block not found.");
      return;
    }

    const start = data.start_time || "09:00:00";
    const end = data.end_time || "10:00:00";

    const isAllDayBlock =
      start === "00:00:00" && (end === "23:59:00" || end === "23:59:59");

    setEntryType(data.block_type || "blocked");
    setTitle(data.title || "");
    setAppointmentDate(data.block_date || todayIso());
    setStartTime(String(start).slice(0, 5));
    setEndTime(String(end).slice(0, 5));
    setNotes(data.notes || "");
    setAllDay(isAllDayBlock);
  }

  async function saveQuickClient() {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    if (!userId) {
      Alert.alert("Login Required", "Please sign in to add a client.");
      return;
    }

    if (!newClientName && !newClientPhone && !newClientEmail) {
      Alert.alert("Missing Info", "Add a name, phone, or email.");
      return;
    }

    const { data, error } = await supabase
      .from("clients")
      .insert({
        user_id: userId,
        name: newClientName || "New Client",
        phone: newClientPhone || null,
        email: newClientEmail || null,
      })
      .select("*")
      .single();

    if (error) {
      Alert.alert("Error", error.message);
      return;
    }

    setClients((current) =>
      [...current, data].sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || "")),
      ),
    );

    setSelectedClient(data.id);
    setNewClientName("");
    setNewClientPhone("");
    setNewClientEmail("");
    setShowQuickClient(false);
  }

  async function saveQuickService() {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        Alert.alert("Login Required", "Please sign in to add a service.");
        return;
      }

      if (!newServiceName.trim()) {
        Alert.alert("Missing Info", "Enter a service name.");
        return;
      }

      const serviceData = {
        user_id: userId,
        name: newServiceName.trim(),
        price: Number(newServicePrice || 0),
        duration_minutes: Number(newServiceDuration || 30),
      };

      const { data, error } = await supabase
        .from("services")
        .insert(serviceData)
        .select("*")
        .single();

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      setServices((current) =>
        [...current, data].sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || "")),
        ),
      );

      setSelectedService(data.id);
      setNewServiceName("");
      setNewServicePrice("");
      setNewServiceDuration("30");
      setShowQuickService(false);
    } catch (error: any) {
      Alert.alert("Error", error?.message || "Could not save service.");
    }
  }

  async function saveEntry() {
    if (saving) return;

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        Alert.alert("Login Required", "You must be logged in.");
        return;
      }

      if (!appointmentDate) {
        Alert.alert("Missing Date", "Please choose a date.");
        return;
      }

      const safeDate = appointmentDate || todayIso();

      if (entryType === "appointment") {
        await saveAppointment(userId, safeDate);
        router.push("/dashboard");
        return;
      }

      await saveCalendarBlock(userId, safeDate);
      router.push("/dashboard");
      return;
    } finally {
      setSaving(false);
    }
  }

  async function saveAppointment(userId: string, safeDate: string) {
    if (!selectedService) {
      Alert.alert("Missing Info", "Select a service.");
      throw new Error("Missing service");
    }

    const client = clients.find((item) => item.id === selectedClient);
    const service = services.find((item) => item.id === selectedService);

    const finalEndTime = calculateEndTime(
      startTime,
      service?.duration_minutes || 30,
    );

    const appointmentData = {
      user_id: userId,
      client_name: client?.name || "New Client",
      service_id: selectedService,
      appointment_date: safeDate,
      appointment_time: toSqlTime(startTime, "09:00:00"),
      end_time: toSqlTime(finalEndTime, "09:30:00"),
      appointment_notes: notes || null,
      final_price: service?.price || 0,
      status: "scheduled",
    };

    if (editMode && appointmentId) {
      const { error } = await supabase
        .from("appointments")
        .update(appointmentData)
        .eq("id", appointmentId);

      if (error) {
        Alert.alert("Error", error.message);
        throw error;
      }

      return;
    }

    const { error } = await supabase
      .from("appointments")
      .insert(appointmentData);

    if (error) {
      Alert.alert("Error", error.message);
      throw error;
    }
  }

  async function saveCalendarBlock(userId: string, safeDate: string) {
    const safeStartTime = allDay
      ? "00:00:00"
      : toSqlTime(startTime, "09:00:00");
    const safeEndTime = allDay ? "23:45:00" : toSqlTime(endTime, "10:00:00");

    const blockData = {
      user_id: userId,
      title: title?.trim() || formatBlockTitle(entryType),
      block_date: safeDate,
      start_time: safeStartTime,
      end_time: safeEndTime,
      block_type: entryType || "blocked",
      notes: notes || null,
    };

    if (blockId) {
      const { error } = await supabase
        .from("blocked_times")
        .update(blockData)
        .eq("id", blockId);

      if (error) {
        Alert.alert("Error", error.message);
        throw error;
      }

      return;
    }

    const { error } = await supabase.from("blocked_times").insert(blockData);

    if (error) {
      Alert.alert("Error", error.message);
      throw error;
    }
  }

  function PickerBox({ label, children }: { label: string; children: any }) {
    return (
      <View style={{ marginBottom: 18 }}>
        <Text
          style={{
            color: colors.text,
            fontWeight: "bold",
            marginBottom: 8,
          }}
        >
          {label}
        </Text>

        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            backgroundColor: colors.card,
            overflow: "hidden",
            minHeight: 56,
            justifyContent: "center",
          }}
        >
          {children}
        </View>
      </View>
    );
  }

  function modalInputStyle() {
    return {
      backgroundColor: colors.card,
      color: colors.text,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
    };
  }

  return (
    <ScrollView
      style={{
        flex: 1,
        backgroundColor: colors.background,
        padding: 20,
      }}
    >
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 24,
          color: colors.text,
        }}
      >
        Add To Calendar
      </Text>

      {!isLoggedIn && (
        <Pressable
          onPress={() => router.push("/login")}
          style={{
            backgroundColor: colors.card,
            padding: 16,
            borderRadius: 14,
            alignItems: "center",
            marginBottom: 16,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text
            style={{ color: colors.text, fontWeight: "bold", fontSize: 16 }}
          >
            Sign In to Save Calendar Entries
          </Text>
        </Pressable>
      )}

      <PickerBox label="Type">
        <Picker
          selectedValue={entryType}
          onValueChange={(value) => setEntryType(value)}
          style={{
            width: "100%",
            minHeight: 56,
            color: colors.text,
          }}
        >
          <Picker.Item label="Appointment" value="appointment" />
          <Picker.Item label="Blocked Time" value="blocked" />
          <Picker.Item label="Vacation" value="vacation" />
          <Picker.Item label="Personal Event" value="personal" />
        </Picker>
      </PickerBox>

      {entryType === "appointment" ? (
        <>
          <Text
            style={{ color: colors.text, fontWeight: "bold", marginBottom: 8 }}
          >
            Client
          </Text>

          <Dropdown
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              backgroundColor: colors.card,
            }}
            containerStyle={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
            itemTextStyle={{ color: colors.text }}
            selectedTextStyle={{ color: colors.text }}
            placeholderStyle={{ color: colors.mutedText }}
            inputSearchStyle={{
              color: colors.text,
              backgroundColor: colors.card,
              borderRadius: 10,
            }}
            activeColor={colors.background}
            data={[
              { label: "New Client", value: "new_client" },
              ...clients.map((client) => ({
                label: client.name || "Unnamed Client",
                value: client.id,
              })),
            ]}
            search
            maxHeight={300}
            labelField="label"
            valueField="value"
            placeholder="Select Client"
            searchPlaceholder="Search clients..."
            value={selectedClient}
            onChange={(item) => {
              if (item.value === "new_client") {
                setShowQuickClient(true);
                return;
              }

              setSelectedClient(item.value);
            }}
          />

          <Text
            style={{ color: colors.text, fontWeight: "bold", marginBottom: 8 }}
          >
            Service
          </Text>

          <Dropdown
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              backgroundColor: colors.card,
            }}
            containerStyle={{
              backgroundColor: colors.card,
              borderColor: colors.border,
            }}
            itemTextStyle={{ color: colors.text }}
            selectedTextStyle={{ color: colors.text }}
            placeholderStyle={{ color: colors.mutedText }}
            inputSearchStyle={{
              color: colors.text,
              backgroundColor: colors.card,
              borderRadius: 10,
            }}
            activeColor={colors.background}
            data={[
              ...services.map((service) => ({
                label: service.name || "Unnamed Service",
                value: service.id,
              })),
            ]}
            search
            maxHeight={300}
            labelField="label"
            valueField="value"
            placeholder="Select Service"
            searchPlaceholder="Search services..."
            value={selectedService}
            onChange={(item) => {
              setSelectedService(item.value);
            }}
          />

          <Pressable
            onPress={() => {
              setSelectedService("");
              setShowQuickService(true);
            }}
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              alignItems: "center",
              marginTop: -8,
              marginBottom: 20,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontWeight: "bold",
                fontSize: 15,
              }}
            >
              + Quick Add Service
            </Text>
          </Pressable>
        </>
      ) : (
        <View style={{ marginBottom: 18 }}>
          <Text
            style={{ color: colors.text, fontWeight: "bold", marginBottom: 8 }}
          >
            Title
          </Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Vacation, Lunch, Event..."
            placeholderTextColor={colors.mutedText}
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              color: colors.text,
              backgroundColor: colors.card,
            }}
          />
        </View>
      )}

      <View style={{ marginBottom: 18 }}>
        <Text
          style={{ color: colors.text, fontWeight: "bold", marginBottom: 8 }}
        >
          Date
        </Text>

        <Pressable
          onPress={() => setShowDatePicker(true)}
          style={{
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            marginTop: 8,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 16 }}>
            {appointmentDate || "Choose Date"}
          </Text>
        </Pressable>

        {showDatePicker && (
          <DateTimePicker
            value={
              appointmentDate
                ? new Date(`${appointmentDate}T12:00:00`)
                : new Date()
            }
            mode="date"
            display="calendar"
            onChange={(event: DateTimePickerEvent, date?: Date) => {
              setShowDatePicker(false);

              if (date) {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, "0");
                const day = String(date.getDate()).padStart(2, "0");

                setAppointmentDate(`${year}-${month}-${day}`);
              }
            }}
          />
        )}
      </View>

      {entryType !== "appointment" && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 18,
          }}
        >
          <Text style={{ fontWeight: "bold", color: colors.text }}>
            All Day
          </Text>
          <Switch value={allDay} onValueChange={setAllDay} />
        </View>
      )}

      {!allDay && (
        <>
          <PickerBox label="Start Time">
            <Picker
              selectedValue={startTime}
              onValueChange={setStartTime}
              style={{
                width: "100%",
                height: 56,
                color: colors.text,
              }}
            >
              {TIMES.map((time) => (
                <Picker.Item key={time} label={time} value={time} />
              ))}
            </Picker>
          </PickerBox>

          {entryType !== "appointment" && (
            <PickerBox label="End Time">
              <Picker
                selectedValue={endTime}
                onValueChange={setEndTime}
                style={{
                  width: "100%",
                  height: 56,
                  color: colors.text,
                }}
              >
                {TIMES.map((time) => (
                  <Picker.Item key={time} label={time} value={time} />
                ))}
              </Picker>
            </PickerBox>
          )}
        </>
      )}

      <View style={{ marginBottom: 24 }}>
        <Text
          style={{ color: colors.text, fontWeight: "bold", marginBottom: 8 }}
        >
          Notes
        </Text>

        <TextInput
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Optional notes..."
          placeholderTextColor={colors.mutedText}
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            padding: 14,
            minHeight: 120,
            textAlignVertical: "top",
            color: colors.text,
            backgroundColor: colors.card,
          }}
        />
      </View>

      <Pressable
        disabled={saving}
        onPress={saveEntry}
        style={{
          backgroundColor: saving ? "#94A3B8" : colors.primary,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <Text style={{ color: "#FFFFFF", fontWeight: "bold", fontSize: 16 }}>
          {saving ? "Saving..." : "Save Calendar Entry"}
        </Text>
      </Pressable>

      <Pressable
        onPress={() => router.push("/dashboard")}
        style={{
          backgroundColor: colors.card,
          padding: 16,
          borderRadius: 14,
          alignItems: "center",
          marginBottom: 40,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: colors.text, fontWeight: "bold", fontSize: 16 }}>
          Back to Dashboard
        </Text>
      </Pressable>

      <Modal visible={showQuickClient} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              padding: 20,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 24,
                fontWeight: "bold",
                marginBottom: 16,
              }}
            >
              Quick Add Client
            </Text>

            <TextInput
              value={newClientName}
              onChangeText={setNewClientName}
              placeholder="Name"
              placeholderTextColor={colors.mutedText}
              style={modalInputStyle()}
            />

            <TextInput
              value={newClientPhone}
              onChangeText={setNewClientPhone}
              placeholder="Phone"
              placeholderTextColor={colors.mutedText}
              keyboardType="phone-pad"
              style={modalInputStyle()}
            />

            <TextInput
              value={newClientEmail}
              onChangeText={setNewClientEmail}
              placeholder="Email"
              placeholderTextColor={colors.mutedText}
              keyboardType="email-address"
              autoCapitalize="none"
              style={modalInputStyle()}
            />

            <Pressable
              onPress={saveQuickClient}
              style={{
                backgroundColor: colors.primary,
                padding: 16,
                borderRadius: 14,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontWeight: "bold", fontSize: 16 }}
              >
                Save Client
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowQuickClient(false)}
              style={{
                backgroundColor: colors.card,
                padding: 16,
                borderRadius: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{ color: colors.text, fontWeight: "bold", fontSize: 16 }}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={showQuickService} transparent animationType="slide">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              padding: 20,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: 24,
                fontWeight: "bold",
                marginBottom: 16,
              }}
            >
              Quick Add Service
            </Text>

            <TextInput
              value={newServiceName}
              onChangeText={setNewServiceName}
              placeholder="Service Name"
              placeholderTextColor={colors.mutedText}
              style={modalInputStyle()}
            />

            <TextInput
              value={newServicePrice}
              onChangeText={setNewServicePrice}
              placeholder="Price"
              placeholderTextColor={colors.mutedText}
              keyboardType="numeric"
              style={modalInputStyle()}
            />

            <TextInput
              value={newServiceDuration}
              onChangeText={setNewServiceDuration}
              placeholder="Duration Minutes"
              placeholderTextColor={colors.mutedText}
              keyboardType="numeric"
              style={modalInputStyle()}
            />

            <Pressable
              onPress={saveQuickService}
              style={{
                backgroundColor: colors.primary,
                padding: 16,
                borderRadius: 14,
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <Text
                style={{ color: "#FFFFFF", fontWeight: "bold", fontSize: 16 }}
              >
                Save Service
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setShowQuickService(false)}
              style={{
                backgroundColor: colors.card,
                padding: 16,
                borderRadius: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                style={{ color: colors.text, fontWeight: "bold", fontSize: 16 }}
              >
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
