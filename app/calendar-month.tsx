import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function CalendarMonthScreen() {
  const router = useRouter();
  const [monthOffset, setMonthOffset] = useState(0);

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
    <ScrollView style={{ flex: 1, backgroundColor: "#ffffff", padding: 20 }}>
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          color: "#111111",
          marginBottom: 16,
        }}
      >
        Month View
      </Text>

      <View style={{ flexDirection: "row", marginBottom: 18 }}>
        <Pressable
          onPress={() => setMonthOffset(monthOffset - 1)}
          style={{
            flex: 1,
            backgroundColor: "#111111",
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#ffffff", fontWeight: "bold" }}>← Month</Text>
        </Pressable>

        <View style={{ width: 10 }} />

        <Pressable
          onPress={() => setMonthOffset(monthOffset + 1)}
          style={{
            flex: 1,
            backgroundColor: "#111111",
            padding: 14,
            borderRadius: 12,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#ffffff", fontWeight: "bold" }}>Month →</Text>
        </Pressable>
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          color: "#111111",
          marginBottom: 16,
          textAlign: "center",
        }}
      >
        {monthName}
      </Text>

      <View style={{ flexDirection: "row", marginBottom: 8 }}>
        {DAYS.map((day) => (
          <View key={day} style={{ flex: 1, alignItems: "center" }}>
            <Text style={{ fontWeight: "bold", color: "#666666" }}>{day}</Text>
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
                  backgroundColor: today ? "#0F766E" : "#F3F4F6",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: today ? "#ffffff" : "#111111",
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
          color: "#666666",
          textAlign: "center",
          marginTop: 20,
        }}
      >
        Tap any date to return to the weekly calendar.
      </Text>
    </ScrollView>
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
