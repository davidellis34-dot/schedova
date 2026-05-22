import { useRouter } from "expo-router";
import {
  Alert,
  Dimensions,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { Dropdown } from "react-native-element-dropdown";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import * as Haptics from "expo-haptics";
import { blockTitleFor, normalizeId } from "../components/booking/bookingUtils";
import { DatePickerField } from "../components/booking/DatePickerField";
import { EntryTypePicker } from "../components/booking/EntryTypePicker";
import { PickerBox } from "../components/booking/PickerBox";
import { QuickClientModal } from "../components/booking/QuickClientModal";
import { QuickServiceModal } from "../components/booking/QuickServiceModal";
import { SelectedServicesList } from "../components/booking/SelectedServicesList";
import { TimeDropdown } from "../components/booking/TimeDropdown";
import type { ThemeColors } from "../components/booking/types";
import { useBookAppointmentForm } from "../components/booking/useBookAppointmentForm";
import { sendAppointmentSmsNonBlocking } from "../lib/appointmentSms";
import { confirmDestructiveAction } from "../lib/confirmDestructiveAction";
import { canUseFeature } from "../lib/featureAccess";
import { cancelAppointmentReminder } from "../lib/localNotifications";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";
const FALLBACK_COLORS: ThemeColors = {
  background: "#FFFFFF",
  card: "#F8FAFC",
  text: "#111827",
  mutedText: "#6B7280",
  border: "#E5E7EB",
  primary: "#2563EB",
};

const isTablet = Dimensions.get("window").width >= 768;

function textInputStyle(colors: ThemeColors) {
  return {
    backgroundColor: colors.card,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 14,
    marginBottom: 18,
  };
}
export default function BookAppointmentScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const colors: ThemeColors = { ...FALLBACK_COLORS, ...(theme?.colors || {}) };
  const form = useBookAppointmentForm();
  const customScheduleAvailable = canUseFeature("customBusinessHours");

  async function handleDeleteAppointment() {
    const appointmentId = form.appointmentId;

    if (!appointmentId) return;

    await confirmDestructiveAction({
      title: "Delete Appointment",
      message: "This appointment will be permanently deleted.",
      confirmText: "Delete",
      onConfirm: async () => {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (userError || !user) {
          Alert.alert("Not signed in", "Please sign in again.");
          return;
        }

        if (canUseFeature("smsAutomation")) {
          await sendAppointmentSmsNonBlocking(appointmentId, "cancellation");
        }

        const { error } = await supabase
          .from("appointments")
          .delete()
          .eq("id", appointmentId)
          .eq("user_id", user.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }

        await cancelAppointmentReminder(appointmentId);
        router.replace("/calendar-view" as any);
      },
    });
  }

  const isDarkMode =
    colors.background === "#111827" || colors.background === "#0F172A";

  const dropdownBackground = isDarkMode ? "#1E293B" : colors.card;
  const dropdownText = isDarkMode ? "#FFFFFF" : colors.text;

  const dropdownBoxStyle = {
    minHeight: 56,
    paddingHorizontal: 14,
    paddingTop: 6,
    backgroundColor: dropdownBackground,
    borderRadius: 14,
    justifyContent: "center" as const,
  };

  const inputStyle = textInputStyle(colors);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{
          padding: isTablet ? 24 : 16,
          paddingBottom: 140,
        }}
      >
        <Text
          style={{
            color: colors.text,
            fontSize: 30,
            fontWeight: "900",
            marginBottom: 6,
          }}
        >
          {form.isEditMode ? "Edit Calendar Entry" : "Book Appointment"}
        </Text>

        <Text style={{ color: colors.mutedText, marginBottom: 22 }}>
          {form.entryType === "appointment"
            ? "Appointment details"
            : blockTitleFor(form.entryType)}
        </Text>

        <EntryTypePicker
          value={form.entryType}
          onChange={(nextEntryType) => {
            if (
              nextEntryType !== "appointment" &&
              !customScheduleAvailable
            ) {
              Alert.alert(
                "Schedova Pro",
                "Blocked time and custom business hours are Pro features.",
              );
              return;
            }

            form.setEntryType(nextEntryType);
          }}
          colors={colors}
        />

        {!customScheduleAvailable ? (
          <View
            style={{
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "900" }}>
              Schedova Pro
            </Text>
            <Text style={{ color: colors.mutedText, marginTop: 6 }}>
              Blocked time, vacation blocks, and custom business hours are
              locked on Free.
            </Text>
          </View>
        ) : null}

        {form.entryType === "appointment" ? (
          <>
            <PickerBox label="Client" colors={colors}>
              <Dropdown
                selectedTextStyle={{
                  color: dropdownText,
                  fontSize: 16,
                  fontWeight: "700",
                }}
                maxHeight={300}
                showsVerticalScrollIndicator={false}
                data={form.clientDropdownData}
                search
                searchPlaceholder="Search clients..."
                labelField="label"
                valueField="value"
                value={form.selectedClient || null}
                selectedTextProps={{ numberOfLines: 1 }}
                placeholder="Select client"
                placeholderStyle={{
                  color: dropdownText,
                  fontSize: 16,
                  fontWeight: "700",
                }}
                itemTextStyle={{
                  color: dropdownText,
                  fontSize: 16,
                }}
                containerStyle={{
                  backgroundColor: dropdownBackground,
                  borderColor: colors.border,
                  borderRadius: 12,
                  zIndex: 999,
                  elevation: 10,
                }}
                activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
                flatListProps={{
                  keyboardShouldPersistTaps: "handled",
                }}
                style={[
                  dropdownBoxStyle,
                  {
                    minHeight: 52,
                  },
                ]}
                onChange={(item: any) => {
                  if (item?.value === "new_client") {
                    form.setShowQuickClient(true);
                    return;
                  }

                  form.setSelectedClient(normalizeId(item?.value));
                }}
              />
            </PickerBox>

            <PickerBox label="Add Service" colors={colors}>
              <Dropdown
                maxHeight={300}
                showsVerticalScrollIndicator={false}
                data={form.serviceDropdownData}
                labelField="label"
                valueField="value"
                value={null}
                selectedTextProps={{ numberOfLines: 1 }}
                placeholder="Select service"
                placeholderStyle={{
                  color: dropdownText,
                  fontSize: 16,
                  fontWeight: "700",
                }}
                selectedTextStyle={{
                  color: dropdownText,
                  fontSize: 16,
                  fontWeight: "700",
                }}
                itemTextStyle={{
                  color: dropdownText,
                  fontSize: 15,
                }}
                containerStyle={{
                  backgroundColor: dropdownBackground,
                  borderColor: colors.border,
                  borderRadius: 12,
                  zIndex: 999,
                  elevation: 10,
                }}
                activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
                flatListProps={{
                  keyboardShouldPersistTaps: "handled",
                }}
                style={dropdownBoxStyle}
                onChange={(item: any) => {
                  if (item?.value === "new_service") {
                    form.setShowQuickService(true);
                    return;
                  }

                  const picked = form.services.find(
                    (service) =>
                      normalizeId(service.id) === normalizeId(item?.value),
                  );

                  if (picked) form.addServiceToAppointment(picked);
                }}
              />
            </PickerBox>

            <SelectedServicesList
              services={form.selectedServices}
              colors={colors}
              onRemove={form.removeSelectedService}
            />
            {form.selectedServices.length > 0 ? (
              <View
                style={{
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 18,
                }}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "900",
                    fontSize: 15,
                  }}
                >
                  Total:{" "}
                  {form.selectedServices.reduce(
                    (sum, service) =>
                      sum + Number(service.duration_minutes || 0),
                    0,
                  )}{" "}
                  min • $
                  {form.selectedServices.reduce(
                    (sum, service) => sum + Number(service.price || 0),
                    0,
                  )}
                </Text>
              </View>
            ) : null}
          </>
        ) : (
          <TextInput
            value={form.title}
            onChangeText={form.setTitle}
            placeholder={`${blockTitleFor(form.entryType)} title`}
            placeholderTextColor={colors.mutedText}
            style={inputStyle}
          />
        )}

        <DatePickerField
          colors={colors}
          value={form.appointmentDate}
          onChange={form.setAppointmentDate}
          isTablet={isTablet}
        />

        {form.entryType !== "appointment" && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 12,
            }}
          >
            <Text style={{ color: colors.text, fontWeight: "800" }}>
              All Day
            </Text>

            <Switch value={form.allDay} onValueChange={form.setAllDay} />
          </View>
        )}

        {!form.allDay && (
          <>
            <TimeDropdown
              label="Start Time"
              value={form.startTime}
              onChange={(value) => {
                form.setEndTimeManuallyChanged(false);
                form.setStartTime(value);
              }}
              colors={colors}
              use24Hour={form.use24Hour}
              intervalMinutes={form.calendarIntervalMinutes}
              marginTop={8}
            />

            <TimeDropdown
              label="End Time"
              value={form.endTime}
              onChange={(value) => {
                form.setEndTimeManuallyChanged(true);
                form.setEndTime(value);
              }}
              colors={colors}
              use24Hour={form.use24Hour}
              intervalMinutes={form.calendarIntervalMinutes}
              marginTop={16}
            />
          </>
        )}

        <PickerBox label="Repeat" colors={colors}>
          <Dropdown
            maxHeight={300}
            showsVerticalScrollIndicator={false}
            data={[
              { label: "Never", value: "none" },
              { label: "Daily", value: "daily" },
              { label: "Weekly", value: "weekly" },
              { label: "Every 2 Weeks", value: "biweekly" },
              { label: "Monthly", value: "monthly" },
            ]}
            labelField="label"
            valueField="value"
            value={form.repeatType}
            onChange={(item: any) => form.setRepeatType(item.value)}
            selectedTextProps={{ numberOfLines: 1 }}
            placeholder="Never"
            placeholderStyle={{
              color: dropdownText,
              fontSize: 16,
              fontWeight: "700",
            }}
            selectedTextStyle={{
              color: dropdownText,
              fontSize: 16,
              fontWeight: "700",
            }}
            itemTextStyle={{
              color: dropdownText,
              fontSize: 15,
            }}
            containerStyle={{
              backgroundColor: dropdownBackground,
              borderColor: colors.border,
              borderRadius: 12,
              zIndex: 999,
              elevation: 10,
            }}
            activeColor={isDarkMode ? "#334155" : "#F3F4F6"}
            flatListProps={{
              keyboardShouldPersistTaps: "handled",
            }}
            style={dropdownBoxStyle}
          />
        </PickerBox>

        {form.repeatType !== "none" && (
          <DatePickerField
            colors={colors}
            value={form.repeatUntil}
            onChange={form.setRepeatUntil}
            isTablet={isTablet}
          />
        )}

        {form.entryType === "appointment" && (
          <>
            <Text
              style={{
                color: colors.text,
                fontWeight: "800",
                marginBottom: 4,
              }}
            >
              Final Price
            </Text>

            <TextInput
              value={form.finalPrice}
              onChangeText={form.setFinalPrice}
              placeholder="Final price"
              placeholderTextColor={colors.mutedText}
              keyboardType="decimal-pad"
              style={inputStyle}
            />

            <Text
              style={{ color: colors.text, fontWeight: "800", marginBottom: 8 }}
            >
              Notes
            </Text>

            <TextInput
              value={form.appointmentNotes}
              onChangeText={form.setAppointmentNotes}
              placeholder="Appointment notes"
              placeholderTextColor={colors.mutedText}
              multiline
              textAlignVertical="top"
              style={[inputStyle, { minHeight: 110 }]}
            />
          </>
        )}

        <Pressable
          disabled={form.saving || form.loading}
          onPress={async () => {
            await form.saveEntry();

            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          }}
          style={{
            backgroundColor: form.saving ? colors.mutedText : colors.primary,
            padding: isTablet ? 24 : 16,
            borderRadius: 16,
            alignItems: "center",
            marginTop: 28,
            marginBottom: 10,
          }}
        >
          <Text style={{ color: "white", fontWeight: "900", fontSize: 16 }}>
            {form.saving ? "Saving..." : "Save Calendar Entry"}
          </Text>
        </Pressable>

        {form.isEditMode && form.appointmentId ? (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

              handleDeleteAppointment();
            }}
            style={{
              backgroundColor: "#DC2626",
              padding: isTablet ? 24 : 16,
              borderRadius: 16,
              alignItems: "center",
              marginBottom: 10,
              marginTop: 2,
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontWeight: "900",
                fontSize: 16,
              }}
            >
              Delete Appointment
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.back()}
          style={{
            padding: isTablet ? 24 : 16,
            alignItems: "center",
            marginTop: 4,
          }}
        >
          <Text style={{ color: colors.mutedText, fontWeight: "800" }}>
            Cancel
          </Text>
        </Pressable>
      </ScrollView>

      <QuickClientModal
        visible={form.showQuickClient}
        colors={colors}
        name={form.newClientName}
        phone={form.newClientPhone}
        email={form.newClientEmail}
        onChangeName={form.setNewClientName}
        onChangePhone={form.setNewClientPhone}
        onChangeEmail={form.setNewClientEmail}
        onCancel={() => form.setShowQuickClient(false)}
        onSave={form.saveQuickClient}
      />

      <QuickServiceModal
        visible={form.showQuickService}
        colors={colors}
        name={form.newServiceName}
        price={form.newServicePrice}
        duration={form.newServiceDuration}
        onChangeName={form.setNewServiceName}
        onChangePrice={form.setNewServicePrice}
        onChangeDuration={form.setNewServiceDuration}
        onCancel={() => form.setShowQuickService(false)}
        onSaved={(service: any) => {
          form.addServiceToAppointment(service);
          form.setShowQuickService(false);
        }}
        userId={form.userId}
      />
    </GestureHandlerRootView>
  );
}
