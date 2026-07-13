import { Pressable, Text, View } from "react-native";
import type { ThemeColors } from "./types";

type Props = {
  durationMinutes: number;
  defaultMinutes: number;
  onChange: (durationMinutes: number) => void;
  minMinutes?: number;
  step?: number;
  colors: ThemeColors;
};

function normalizeDuration(value: number, minMinutes: number, step: number) {
  const safeValue = Number.isFinite(value) ? value : minMinutes;
  const stepped = Math.round(safeValue / step) * step;
  return Math.max(minMinutes, stepped);
}

export function DurationStepper({
  durationMinutes,
  defaultMinutes,
  onChange,
  minMinutes = 5,
  step = 5,
  colors,
}: Props) {
  const duration = normalizeDuration(durationMinutes, minMinutes, step);
  const defaultDuration = normalizeDuration(defaultMinutes, minMinutes, step);
  const differsFromDefault = duration !== defaultDuration;

  function update(nextValue: number) {
    onChange(normalizeDuration(nextValue, minMinutes, step));
  }

  return (
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
          fontSize: 15,
          fontWeight: "900",
          marginBottom: 10,
        }}
      >
        Duration
      </Text>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Decrease duration"
          onPress={() => update(duration - step)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.background,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.text, fontSize: 24, fontWeight: "900" }}>
            -
          </Text>
        </Pressable>

        <Text
          style={{
            color: colors.text,
            flex: 1,
            textAlign: "center",
            fontSize: 20,
            fontWeight: "900",
          }}
        >
          {duration} min
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Increase duration"
          onPress={() => update(duration + step)}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 24, fontWeight: "900" }}>
            +
          </Text>
        </Pressable>
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginTop: 10,
        }}
      >
        <Text style={{ color: colors.mutedText, flex: 1 }}>
          Default duration: {defaultDuration} min
        </Text>

        {differsFromDefault ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => update(defaultDuration)}
            hitSlop={8}
          >
            <Text style={{ color: colors.primary, fontWeight: "900" }}>
              Reset
            </Text>
          </Pressable>
        ) : null}
      </View>

      {differsFromDefault ? (
        <Text style={{ color: colors.mutedText, fontSize: 12, marginTop: 6 }}>
          Custom duration for this appointment
        </Text>
      ) : null}
    </View>
  );
}
