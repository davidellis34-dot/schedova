import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useState } from "react";

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
    mutedText: "#D1D5DB",
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

type ThemeContextValue = {
  themeName: AppTheme;
  colors: typeof THEMES.white;
  setTheme: (theme: AppTheme) => Promise<void>;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeName, setThemeName] = useState<AppTheme>("white");

  useEffect(() => {
    let active = true;

    async function loadTheme() {
      const savedTheme = await AsyncStorage.getItem("schedova_theme");

      if (
        savedTheme === "white" ||
        savedTheme === "dark" ||
        savedTheme === "black" ||
        savedTheme === "brand"
      ) {
        if (active) setThemeName(savedTheme);
      }
    }

    loadTheme();

    return () => {
      active = false;
    };
  }, []);

  async function setTheme(theme: AppTheme) {
    await AsyncStorage.setItem("schedova_theme", theme);
    setThemeName(theme);
  }

  return (
    <ThemeContext.Provider
      value={{
        themeName,
        colors: THEMES[themeName],
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useGlobalTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useGlobalTheme must be used inside ThemeProvider");
  }

  return context;
}
