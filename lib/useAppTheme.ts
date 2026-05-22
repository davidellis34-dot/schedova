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
    text: "#064E3B",
    mutedText: "#047857",
    border: "#0F766E",
    primary: "#0F766E",
  },
};

let globalTheme: AppTheme = "white";
let listeners: Array<(theme: AppTheme) => void> = [];

function notifyThemeChange(theme: AppTheme) {
  globalTheme = theme;
  listeners.forEach((listener) => listener(theme));
}

function isAppTheme(value: string | null): value is AppTheme {
  return (
    value === "white" ||
    value === "dark" ||
    value === "black" ||
    value === "brand"
  );
}

export function useAppTheme() {
  const [themeName, setThemeName] = useState<AppTheme>(globalTheme);

  useEffect(() => {
    listeners.push(setThemeName);

    let active = true;

    async function loadTheme() {
      try {
        const savedTheme = await AsyncStorage.getItem("schedova_theme");
        const nextTheme = isAppTheme(savedTheme) ? savedTheme : "white";

        if (active) {
          notifyThemeChange(nextTheme);
        }
      } catch (error) {
        console.log("🔥 APP THEME LOAD ERROR:", error);
        if (active) {
          notifyThemeChange("white");
        }
      }
    }

    loadTheme();

    return () => {
      active = false;
      listeners = listeners.filter((listener) => listener !== setThemeName);
    };
  }, []);

  async function setTheme(theme: AppTheme) {
    await AsyncStorage.setItem("schedova_theme", theme);
    notifyThemeChange(theme);
  }

  return {
    themeName,
    colors: THEMES[themeName],
    setTheme,
  };
}
