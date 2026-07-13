import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../components/layout/AppScreen";
import { useAppTheme } from "../lib/useAppTheme";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarMonthScreen() {
  const router = useRouter();
  const { colors, themeName } = useAppTheme();
  const [monthOffset, setMonthOffset] = useState(0);
  const isDarkTheme = themeName === "dark" || themeName === "black";
  const infoAccent = isDarkTheme ? "#60A5FA" : "#2563EB";
  const infoAccentBorder = isDarkTheme
    ? "rgba(96, 165, 250, 0.32)"
    : "rgba(37, 99, 235, 0.24)";
  const polishedBorder = isDarkTheme
    ? "rgba(148, 163, 184, 0.28)"
    : "rgba(15, 23, 42, 0.12)";

  const monthDate = useMemo(() => {
    const date = new Date();
    date.setMonth(date.getMonth() + monthOffset);
    return date;
  }, [monthOffset]);

  const monthName = monthDate.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const days = getMonthDays(monthDate);

  function openWeek(date: Date) {
    router.replace({
      pathname: "/calendar-view",
      params: {
        selectedDate: date.toISOString().split("T")[0],
      },
    });
  }

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <View
          style={{
            width: 4,
            height: 26,
            borderRadius: 999,
            backgroundColor: infoAccent,
          }}
        />
        <Text
          style={{
            fontSize: 30,
            fontWeight: "bold",
            color: colors.text,
          }}
        >
          Month View
        </Text>
      </View>

      <View style={{ flexDirection: "row", marginBottom: 18 }}>
        <Pressable
          onPress={() => setMonthOffset(monthOffset - 1)}
          style={{
            flex: 1,
            backgroundColor: colors.card,
            borderColor: polishedBorder,
            borderWidth: 1,
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: infoAccent, fontWeight: "900" }}>
            Previous Month
          </Text>
        </Pressable>

        <View style={{ width: 10 }} />

        <Pressable
          onPress={() => setMonthOffset(monthOffset + 1)}
          style={{
            flex: 1,
            backgroundColor: colors.card,
            borderColor: polishedBorder,
            borderWidth: 1,
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: infoAccent, fontWeight: "900" }}>
            Next Month
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          backgroundColor: colors.card,
          borderColor: infoAccentBorder,
          borderLeftColor: infoAccent,
          borderLeftWidth: 4,
          borderWidth: 1,
          borderRadius: 16,
          marginBottom: 16,
          padding: 16,
        }}
      >
        <Text
          style={{
            fontSize: 22,
            fontWeight: "bold",
            color: colors.text,
            textAlign: "center",
          }}
        >
          {monthName}
        </Text>
      </View>

      <View style={{ flexDirection: "row", marginBottom: 8 }}>
        {DAYS.map((day) => (
          <View key={day} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontWeight: "bold", color: colors.mutedText }}>
              {day}
            </Text>
          </View>
        ))}
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {days.map((item, index) => {
          if (!item) {
            return (
              <View
                key={`empty-${index}`}
                style={{ width: "14.28%", height: 76 }}
              />
            );
          }

          const today = isToday(item);

          return (
            <Pressable
              key={item.toISOString()}
              onPress={() => openWeek(item)}
              style={{
                width: "14.28%",
                height: 76,
                padding: 4,
              }}
            >
              <View
                style={{
                  flex: 1,
                  borderRadius: 12,
                  backgroundColor: today ? infoAccent : colors.card,
                  borderColor: today ? infoAccent : polishedBorder,
                  borderWidth: 1,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: today ? "#FFFFFF" : colors.text,
                    fontWeight: "bold",
                  }}
                >
                  {item.getDate()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text
        style={{
          color: colors.mutedText,
          textAlign: "center",
          marginTop: 20,
        }}
      >
        Tap any date to return to the weekly calendar.
      </Text>
    </AppScreen>
  );
}

function getMonthDays(date: Date) {
  const year = date.getFullYear();
  const month = date.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);

  const days: (Date | null)[] = [];

  for (let i = 0; i < firstDay.getDay(); i++) {
    days.push(null);
  }

  for (let day = 1; day <= lastDay.getDate(); day++) {
    days.push(new Date(year, month, day));
  }

  return days;
}

function isToday(date: Date) {
  const today = new Date();

  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}
