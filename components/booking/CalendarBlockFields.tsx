import { Switch, Text, TextInput, View } from "react-native";

type Props = {
  entryType: string;
  title: string;
  setTitle: (value: string) => void;
  allDay: boolean;
  setAllDay: (value: boolean) => void;
  theme: any;
};

export default function CalendarBlockFields({
  entryType,
  title,
  setTitle,
  allDay,
  setAllDay,
  theme,
}: Props) {
  if (entryType === "appointment") return null;

  return (
    <View
      style={{
        backgroundColor: theme.card,
        borderRadius: 16,
        padding: 16,
        marginTop: 16,
        borderWidth: 1,
        borderColor: theme.border,
      }}
    >
      <Text
        style={{
          color: theme.text,
          fontSize: 18,
          fontWeight: "700",
          marginBottom: 14,
        }}
      >
        Event Details
      </Text>

      <Text
        style={{
          color: theme.mutedText,
          marginBottom: 6,
          fontSize: 14,
        }}
      >
        Title
      </Text>

      <TextInput
        value={title}
        onChangeText={setTitle}
        placeholder={
          entryType === "blocked"
            ? "Blocked Time"
            : entryType === "vacation"
              ? "Vacation"
              : "Personal Event"
        }
        placeholderTextColor={theme.mutedText}
        style={{
          backgroundColor: theme.background,
          color: theme.text,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          fontSize: 16,
        }}
      />

      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 18,
        }}
      >
        <Text
          style={{
            color: theme.text,
            fontSize: 16,
            fontWeight: "600",
          }}
        >
          All Day
        </Text>

        <Switch value={allDay} onValueChange={setAllDay} />
      </View>
    </View>
  );
}
