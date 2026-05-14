export type AppTheme = "white" | "black" | "brand" | "dark";

export const themes = {
  white: {
    name: "White",
    background: "#ffffff",
    card: "#F3F4F6",
    text: "#111111",
    mutedText: "#666666",
    primary: "#0F766E",
    secondary: "#2563EB",
    buttonText: "#ffffff",
  },
  black: {
    name: "Black",
    background: "#000000",
    card: "#111111",
    text: "#ffffff",
    mutedText: "#D1D5DB",
    primary: "#ffffff",
    secondary: "#0F766E",
    buttonText: "#000000",
  },
  brand: {
    name: "Schedova Brand",
    background: "#ECFEFF",
    card: "#ffffff",
    text: "#0F172A",
    mutedText: "#475569",
    primary: "#0F766E",
    secondary: "#2563EB",
    buttonText: "#ffffff",
  },
  dark: {
    name: "Dark Mode",
    background: "#0F172A",
    card: "#1E293B",
    text: "#F8FAFC",
    mutedText: "#CBD5E1",
    primary: "#14B8A6",
    secondary: "#3B82F6",
    buttonText: "#ffffff",
  },
};
