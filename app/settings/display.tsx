import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { AppScreen } from "../../components/layout/AppScreen";
import { useAppTheme } from "../../lib/useAppTheme";

type AppTheme = "white" | "dark" | "black" | "brand";

export default function DisplaySettingsScreen() {
  const { setTheme, colors } = useAppTheme();
  const [fontScale, setFontScale] = useState("normal");
  const [selectedTheme, setSelectedTheme] = useState<AppTheme>("brand");

  useEffect(() => {
    loadTheme();
  }, []);

  async function loadTheme() {
    const savedTheme = await AsyncStorage.getItem("schedova_theme");
    const savedFontScale = await AsyncStorage.getItem("font_scale");

    if (savedFontScale) {
      setFontScale(savedFontScale);
    }
    if (
      savedTheme === "white" ||
      savedTheme === "dark" ||
      savedTheme === "black" ||
      savedTheme === "brand"
    ) {
      setSelectedTheme(savedTheme);
    }
  }

  async function saveTheme() {
    await AsyncStorage.setItem("schedova_theme", selectedTheme);
    setTheme(selectedTheme);
    await AsyncStorage.setItem("font_scale", fontScale);
  }

  const themeOptions: {
    label: string;
    value: AppTheme;
    description: string;
  }[] = [
    {
      label: "White",
      value: "white",
      description: "Clean light background for daytime use.",
    },
    {
      label: "Dark",
      value: "dark",
      description: "Softer dark mode with gray cards.",
    },
    {
      label: "Black",
      value: "black",
      description: "Full black background for maximum contrast.",
    },
    {
      label: "Brand",
      value: "brand",
      description: "Schedova green/blue inspired look.",
    },
  ];

  return (
    <AppScreen scroll backgroundColor={colors.background}>
      <Text
        style={{
          fontSize: 30,
          fontWeight: "bold",
          marginBottom: 10,
          color: colors.text,
        }}
      >
        Display & Theme
      </Text>

      <Text
        style={{
          fontSize: 15,
          color: colors.mutedText,
          marginBottom: 24,
          lineHeight: 22,
        }}
      >
        Choose how Schedova looks while you work.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          padding: 18,
          borderRadius: 16,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        {themeOptions.map((option) => {
          const isSelected = selectedTheme === option.value;

          return (
            <Pressable
              key={option.value}
              onPress={() => setSelectedTheme(option.value)}
              style={{
                padding: 16,
                borderRadius: 14,
                marginBottom: 12,
                borderWidth: 2,
                borderColor: isSelected ? colors.primary : colors.border,
                backgroundColor: isSelected ? colors.background : colors.card,
              }}
            >
              <Text
                style={{
                  fontSize: 17,
                  fontWeight: "700",
                  color: colors.text,
                  marginBottom: 4,
                }}
              >
                {isSelected ? "✓ " : ""}
                {option.label}
              </Text>

              <Text
                style={{
                  fontSize: 14,
                  color: colors.mutedText,
                  lineHeight: 20,
                }}
              >
                {option.description}
              </Text>
            </Pressable>
          );
        })}
        <Text
          style={{
            fontSize: 18,
            fontWeight: "700",
            color: colors.text,
            marginBottom: 10,
            marginTop: 10,
          }}
        >
          Font Size
        </Text>

        <View
          style={{
            flexDirection: "row",
            gap: 10,
            marginBottom: 20,
          }}
        >
          {["small", "normal", "large"].map((size) => {
            const selected = fontScale === size;

            return (
              <Pressable
                key={size}
                onPress={() => setFontScale(size)}
                style={{
                  flex: 1,
                  padding: 14,
                  borderRadius: 12,
                  borderWidth: 2,
                  borderColor: selected ? colors.primary : colors.border,
                  backgroundColor: selected ? colors.background : colors.card,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontWeight: "600",
                    textTransform: "capitalize",
                  }}
                >
                  {size}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          onPress={saveTheme}
          style={{
            backgroundColor: colors.primary,
            padding: 16,
            borderRadius: 12,
            alignItems: "center",
            marginTop: 6,
          }}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "bold" }}>
            Save Display Settings
          </Text>
        </Pressable>
      </View>
    </AppScreen>
  );
}
