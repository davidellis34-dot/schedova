import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useState } from "react";

export type AppTheme = "white" | "dark" | "black" | "brand";
const THEMES = {
  white: {
    background: "#FFFFFF",
    card: "#F3F4F6",
    text: "#111827",
    mutedText: "#6B7280",
    border: "#D1D5DB",
    primary: "#0F766E",
  },

  dark: {
    background: "#111827",
    card: "#1F2937",
    text: "#FFFFFF",
    mutedText: "#D1D5DB",
    border: "#374151",
    primary: "#0F766E",
  },

  black: {
    background: "#000000",
    card: "#111111",
    text: "#FFFFFF",
    mutedText: "#9CA3AF",
    border: "#333333",
    primary: "#0F766E",
  },

  brand: {
    background: "#ECFDF5",
    card: "#D1FAE5",
    text: "#111827",
    mutedText: "#6B7280",
    border: "#A7F3D0",
    primary: "#0F766E",
  },
};

export function useTheme() {
  const [themeName, setThemeName] = useState<AppTheme>("white");

  useEffect(() => {
    loadTheme();
  }, []);

  async function loadTheme() {
    const savedTheme = await AsyncStorage.getItem("appTheme");

    if (savedTheme) {
      setThemeName(savedTheme as AppTheme);
    }
  }

  async function changeTheme(newTheme: AppTheme) {
    setThemeName(newTheme);
    await AsyncStorage.setItem("appTheme", newTheme);
  }

  return {
    theme: THEMES[themeName],
    themeName,
    changeTheme,
  };
}
