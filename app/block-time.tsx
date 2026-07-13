import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { Alert, Text, View, type TextInput } from "react-native";
import { AppSelectField } from "../components/AppSelectField";
import {
  AppButton,
  AppCard,
  AppScreen,
  AppTextInput,
  EmptyState,
  ProGateCard,
  ScreenHeader,
  createSchedovaUiTheme,
} from "../components/ui";
import { canUseFeature, useFeatureAccess } from "../lib/featureAccess";
import { ENABLE_PRO } from "../lib/proFeatureFlag";
import {
  openSchedovaProScreen,
  PRO_UPSELL_COPY,
  showProUpgradePrompt,
} from "../lib/proUpsell";
import { supabase } from "../lib/supabase";
import { useAppTheme } from "../lib/useAppTheme";

const BLOCK_TYPE_OPTIONS = [
  { label: "Personal", value: "personal" },
  { label: "Vacation", value: "vacation" },
  { label: "Lunch", value: "lunch" },
  { label: "Closed", value: "closed" },
];

const TIME_OPTIONS = [
  "00:00",
  "00:30",
  "01:00",
  "01:30",
  "02:00",
  "02:30",
  "03:00",
  "03:30",
  "04:00",
  "04:30",
  "05:00",
  "05:30",
  "06:00",
  "06:30",
  "07:00",
  "07:30",
  "08:00",
  "08:30",
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
  "12:00",
  "12:30",
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
  "18:30",
  "19:00",
  "19:30",
  "20:00",
  "20:30",
  "21:00",
  "21:30",
  "22:00",
  "22:30",
  "23:00",
  "23:30",
].map((time) => ({ label: time, value: time }));

type BlockedTime = {
  id: string;
  title?: string | null;
  block_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  block_type?: string | null;
  notes?: string | null;
};

function timeToMinutes(time: string) {
  const [hours, minutes] = String(time || "00:00")
    .slice(0, 5)
    .split(":")
    .map(Number);

  return (
    (Number.isFinite(hours) ? hours : 0) * 60 +
    (Number.isFinite(minutes) ? minutes : 0)
  );
}

function positiveDurationMinutes(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;

  return Math.max(5, Math.round(numberValue / 5) * 5);
}

function getAppointmentEndMinutes(appointment: {
  appointment_time?: unknown;
  end_time?: unknown;
  duration_minutes?: unknown;
}) {
  const startMinutes = timeToMinutes(String(appointment.appointment_time || ""));
  const explicitEnd = appointment.end_time
    ? timeToMinutes(String(appointment.end_time))
    : Number.NaN;

  if (
    Number.isFinite(startMinutes) &&
    Number.isFinite(explicitEnd) &&
    explicitEnd > startMinutes
  ) {
    return explicitEnd;
  }

  const duration = positiveDurationMinutes(appointment.duration_minutes);

  if (Number.isFinite(startMinutes) && duration) {
    return startMinutes + duration;
  }

  return Number.NaN;
}

function blockTypeLabel(value?: string | null) {
  return (
    BLOCK_TYPE_OPTIONS.find((option) => option.value === value)?.label ||
    "Blocked time"
  );
}

function formatDate(value?: string | null) {
  if (!value) return "Date not set";

  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(`2000-01-01T${String(value).slice(0, 5)}:00`);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 5);

  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isAllDayBlock(block: BlockedTime) {
  const start = String(block.start_time || "").slice(0, 5);
  const end = String(block.end_time || "").slice(0, 5);

  return start === "00:00" && (end === "23:45" || end === "23:59");
}

function blockTimeLabel(block: BlockedTime) {
  if (isAllDayBlock(block)) return "All day";

  const start = formatTime(block.start_time);
  const end = formatTime(block.end_time);

  if (!start && !end) return "Time not set";
  if (!end) return start;

  return `${start} - ${end}`;
}

export default function BlockTimeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const theme = createSchedovaUiTheme(colors);
  const { spacing, radii, typography } = theme;
  useFeatureAccess();
  const customScheduleAvailable = canUseFeature("customBusinessHours");

  const titleInputRef = useRef<TextInput>(null);
  const [title, setTitle] = useState("");
  const [blockDate, setBlockDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [blockType, setBlockType] = useState("personal");
  const [notes, setNotes] = useState("");
  const [blocks, setBlocks] = useState<BlockedTime[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);
  const [blockListError, setBlockListError] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);

  const selectColors = useMemo(
    () => ({
      background: colors.background,
      card: colors.card,
      text: colors.text,
      mutedText: colors.mutedText,
      border: colors.border,
      primary: colors.primary,
    }),
    [
      colors.background,
      colors.border,
      colors.card,
      colors.mutedText,
      colors.primary,
      colors.text,
    ],
  );

  const loadBlockedTimes = useCallback(async () => {
    if (!customScheduleAvailable) {
      setBlocks([]);
      setBlockListError("");
      return;
    }

    setLoadingBlocks(true);
    setBlockListError("");

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        setBlocks([]);
        return;
      }

      const { data, error } = await supabase
        .from("blocked_times")
        .select("*")
        .eq("user_id", userId)
        .order("block_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (error) {
        console.log("LOAD BLOCKED TIMES ERROR:", error.message);
        setBlocks([]);
        setBlockListError("Unable to load blocked time.");
        return;
      }

      setBlocks(data || []);
    } finally {
      setLoadingBlocks(false);
    }
  }, [customScheduleAvailable]);

  useFocusEffect(
    useCallback(() => {
      void loadBlockedTimes();
    }, [loadBlockedTimes]),
  );

  async function saveBlock() {
    if (saving) return;

    if (!customScheduleAvailable) {
      if (ENABLE_PRO) {
        showProUpgradePrompt(PRO_UPSELL_COPY.blockedTime);
      } else {
        Alert.alert(
          "Block Time",
          "Blocked time is not available in this version of Schedova.",
        );
      }
      return;
    }

    if (!title || !blockDate || !startTime || !endTime) {
      Alert.alert(
        "Missing Info",
        "Please complete title, date, start time, and end time.",
      );
      return;
    }

    if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
      Alert.alert("Invalid Time", "End time must be after start time.");
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        Alert.alert("Login Required", "You must be logged in.");
        return;
      }

      const { data: overlappingAppointments, error: appointmentError } =
        await supabase
          .from("appointments")
          .select("id, appointment_time, end_time, duration_minutes")
          .eq("user_id", userId)
          .eq("appointment_date", blockDate)
          .neq("status", "canceled");

      if (appointmentError) {
        Alert.alert("Error", appointmentError.message);
        return;
      }

      const blockStartMinutes = timeToMinutes(startTime);
      const blockEndMinutes = timeToMinutes(endTime);
      const hasAppointmentOverlap =
        overlappingAppointments?.some((appointment) => {
          const appointmentStartMinutes = timeToMinutes(
            appointment.appointment_time,
          );
          const appointmentEndMinutes = getAppointmentEndMinutes(appointment);

          if (
            !Number.isFinite(appointmentStartMinutes) ||
            !Number.isFinite(appointmentEndMinutes)
          ) {
            return false;
          }

          return (
            blockStartMinutes < appointmentEndMinutes &&
            blockEndMinutes > appointmentStartMinutes
          );
        }) ?? false;

      if (hasAppointmentOverlap) {
        Alert.alert("Conflict", "This blocked time overlaps an appointment.");
        return;
      }

      const { data: overlappingBlocks, error: blockError } = await supabase
        .from("blocked_times")
        .select("id")
        .eq("user_id", userId)
        .eq("block_date", blockDate)
        .lt("start_time", endTime)
        .gt("end_time", startTime);

      if (blockError) {
        Alert.alert("Error", blockError.message);
        return;
      }

      if (overlappingBlocks?.length) {
        Alert.alert("Conflict", "This time overlaps an existing blocked time.");
        return;
      }

      const { error } = await supabase.from("blocked_times").insert({
        user_id: userId,
        title,
        block_date: blockDate,
        start_time: startTime,
        end_time: endTime,
        block_type: blockType,
        notes,
      });

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      router.back();
    } finally {
      setSaving(false);
    }
  }

  function confirmDeleteBlock(block: BlockedTime) {
    if (!block.id) return;

    Alert.alert(
      "Delete blocked time?",
      `Remove ${block.title || blockTypeLabel(block.block_type)} from your calendar?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void deleteBlock(block.id);
          },
        },
      ],
    );
  }

  async function deleteBlock(blockId: string) {
    if (deletingBlockId) return;

    setDeletingBlockId(blockId);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;

      if (!userId) {
        Alert.alert("Login Required", "You must be logged in.");
        return;
      }

      const { error } = await supabase
        .from("blocked_times")
        .delete()
        .eq("id", blockId)
        .eq("user_id", userId);

      if (error) {
        Alert.alert("Error", error.message);
        return;
      }

      setBlocks((currentBlocks) =>
        currentBlocks.filter((block) => block.id !== blockId),
      );
    } finally {
      setDeletingBlockId(null);
    }
  }

  function renderBlockCard(block: BlockedTime) {
    const label = blockTypeLabel(block.block_type);
    const isVacation = block.block_type === "vacation";
    const isDeleting = deletingBlockId === block.id;

    return (
      <AppCard key={block.id} style={{ marginBottom: spacing.md }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: spacing.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.cardTitle,
                fontWeight: typography.weights.heavy,
              }}
            >
              {block.title || label}
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                marginTop: spacing.xs,
                lineHeight: typography.lineHeights.body,
              }}
            >
              {formatDate(block.block_date)} - {blockTimeLabel(block)}
            </Text>
          </View>

          <View
            style={{
              borderWidth: 1,
              borderColor: isVacation ? theme.colors.warning : colors.primary,
              borderRadius: radii.pill,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.xs,
              backgroundColor: isVacation
                ? "rgba(217, 119, 6, 0.18)"
                : "rgba(15, 118, 110, 0.18)",
            }}
          >
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.caption,
                fontWeight: typography.weights.heavy,
              }}
            >
              {label}
            </Text>
          </View>
        </View>

        {block.notes ? (
          <Text
            style={{
              color: colors.mutedText,
              marginTop: spacing.md,
              lineHeight: typography.lineHeights.body,
            }}
          >
            {block.notes}
          </Text>
        ) : null}

        <AppButton
          title={isDeleting ? "Deleting..." : "Delete"}
          variant="destructive"
          loading={isDeleting}
          disabled={Boolean(deletingBlockId)}
          onPress={() => confirmDeleteBlock(block)}
          style={{ marginTop: spacing.lg }}
        />
      </AppCard>
    );
  }

  if (!customScheduleAvailable) {
    return (
      <AppScreen scroll backgroundColor={colors.background}>
        <ScreenHeader
          title="Block Time"
          subtitle="Reserve time for breaks, personal time, or unavailable hours."
          showBack
        />

        {ENABLE_PRO ? (
          <ProGateCard
            message="Blocked time, vacation blocks, and custom business hours are included with Schedova Pro."
            features={[
              "Block personal time and breaks",
              "Add vacation or closed days",
              "Keep unavailable time off your appointment book",
            ]}
            onPress={openSchedovaProScreen}
          />
        ) : (
          <AppCard>
            <Text
              style={{
                color: colors.text,
                fontSize: typography.sizes.body,
                fontWeight: typography.weights.heavy,
              }}
            >
              Blocked time unavailable
            </Text>
            <Text
              style={{
                color: colors.mutedText,
                lineHeight: 20,
                marginTop: spacing.sm,
              }}
            >
              Blocked time is not available in this version of Schedova.
            </Text>
          </AppCard>
        )}

        <AppButton
          title="Back"
          variant="ghost"
          onPress={() => router.back()}
          style={{ marginTop: spacing.md }}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll keyboardAware backgroundColor={colors.background}>
      <ScreenHeader
        title="Block Time"
        subtitle="Reserve time for breaks, personal time, or unavailable hours."
        showBack
      />

      <AppCard style={{ marginBottom: spacing.xl }}>
        <Text
          style={{
            color: colors.text,
            fontSize: typography.sizes.section,
            fontWeight: typography.weights.heavy,
          }}
        >
          Add blocked time
        </Text>
        <Text
          style={{
            color: colors.mutedText,
            lineHeight: typography.lineHeights.body,
            marginTop: spacing.sm,
            marginBottom: spacing.lg,
          }}
        >
          Add time away from your appointment book so clients are not scheduled
          when you are unavailable.
        </Text>

        <AppTextInput
          ref={titleInputRef}
          label="Title"
          value={title}
          onChangeText={setTitle}
          placeholder="Vacation, lunch, personal event"
          autoCapitalize="words"
        />

        <AppTextInput
          label="Date"
          value={blockDate}
          onChangeText={setBlockDate}
          placeholder="YYYY-MM-DD"
          helperText="Use the date you want to block."
          autoCapitalize="none"
        />

        <TimePicker
          label="Start Time"
          value={startTime}
          onChange={setStartTime}
          colors={selectColors}
        />

        <TimePicker
          label="End Time"
          value={endTime}
          onChange={setEndTime}
          colors={selectColors}
        />

        <AppSelectField
          label="Type"
          value={blockType}
          options={BLOCK_TYPE_OPTIONS}
          onChange={setBlockType}
          colors={selectColors}
        />

        <AppTextInput
          label="Notes"
          value={notes}
          onChangeText={setNotes}
          multiline
          placeholder="Optional notes..."
        />

        <AppButton
          title={saving ? "Saving..." : "Save Blocked Time"}
          loading={saving}
          disabled={saving}
          onPress={saveBlock}
        />
      </AppCard>

      <Text
        style={{
          color: colors.text,
          fontSize: typography.sizes.section,
          fontWeight: typography.weights.heavy,
          marginBottom: spacing.md,
        }}
      >
        Blocked time
      </Text>

      {loadingBlocks ? (
        <AppCard>
          <Text style={{ color: colors.mutedText }}>Loading blocked time...</Text>
        </AppCard>
      ) : blockListError ? (
        <AppCard>
          <Text
            style={{
              color: colors.mutedText,
              lineHeight: typography.lineHeights.body,
            }}
          >
            {blockListError}
          </Text>
        </AppCard>
      ) : blocks.length ? (
        blocks.map(renderBlockCard)
      ) : (
        <EmptyState
          title="No blocked time yet"
          message="Block time to keep appointments from being booked when you are unavailable."
          actionLabel="Add Blocked Time"
          onAction={() => titleInputRef.current?.focus()}
        />
      )}
    </AppScreen>
  );
}

function TimePicker({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  colors: {
    background: string;
    card: string;
    text: string;
    mutedText: string;
    border: string;
    primary: string;
  };
}) {
  return (
    <AppSelectField
      label={label}
      value={value}
      options={TIME_OPTIONS}
      onChange={onChange}
      colors={colors}
    />
  );
}
