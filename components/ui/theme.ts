import type { TextStyle, ViewStyle } from "react-native";

export type SchedovaUiColors = {
  background: string;
  card: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
  destructive: string;
  warning: string;
  success: string;
  info: string;
  surface: string;
  surfaceMuted: string;
  disabled: string;
  white: string;
};

export const schedovaColors: SchedovaUiColors = {
  background: "#111827",
  card: "#1F2937",
  text: "#F9FAFB",
  mutedText: "#CBD5E1",
  border: "#374151",
  primary: "#0F766E",
  destructive: "#DC2626",
  warning: "#D97706",
  success: "#16A34A",
  info: "#2563EB",
  surface: "#243047",
  surfaceMuted: "#172033",
  disabled: "#64748B",
  white: "#FFFFFF",
};

export const schedovaSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
} as const;

export const schedovaRadii = {
  xs: 6,
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  "2xl": 22,
  pill: 999,
} as const;

export const schedovaTypography = {
  sizes: {
    caption: 12,
    helper: 13,
    body: 15,
    bodyLarge: 16,
    section: 20,
    cardTitle: 18,
    title: 34,
    titleLarge: 36,
    metric: 27,
  },
  weights: {
    regular: "400" as TextStyle["fontWeight"],
    medium: "600" as TextStyle["fontWeight"],
    semibold: "700" as TextStyle["fontWeight"],
    bold: "800" as TextStyle["fontWeight"],
    heavy: "900" as TextStyle["fontWeight"],
  },
  lineHeights: {
    helper: 19,
    body: 22,
    subtitle: 24,
    title: 40,
  },
} as const;

export const schedovaBorders = {
  width: 1,
} as const;

export const schedovaShadows = {
  card: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 18,
    elevation: 4,
  } satisfies ViewStyle,
  button: {
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 3,
  } satisfies ViewStyle,
} as const;

export type SchedovaStatusTone =
  | "scheduled"
  | "confirmed"
  | "completed"
  | "canceled"
  | "noShow"
  | "fallback";

export const schedovaStatusTones: Record<
  SchedovaStatusTone,
  { label: string; background: string; text: string; border: string }
> = {
  scheduled: {
    label: "Scheduled",
    background: "#0F766E",
    text: "#FFFFFF",
    border: "#0F766E",
  },
  confirmed: {
    label: "Confirmed",
    background: "#2563EB",
    text: "#FFFFFF",
    border: "#2563EB",
  },
  completed: {
    label: "Completed",
    background: "#15803D",
    text: "#FFFFFF",
    border: "#15803D",
  },
  canceled: {
    label: "Canceled",
    background: "#991B1B",
    text: "#FFFFFF",
    border: "#991B1B",
  },
  noShow: {
    label: "No-show",
    background: "#C2410C",
    text: "#FFFFFF",
    border: "#C2410C",
  },
  fallback: {
    label: "Status",
    background: "#374151",
    text: "#F9FAFB",
    border: "#475569",
  },
};

export function normalizeStatusTone(status?: string | null): SchedovaStatusTone {
  const normalized = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/-/g, "_");

  if (!normalized || normalized === "scheduled") return "scheduled";
  if (normalized === "confirmed") return "confirmed";
  if (normalized === "completed") return "completed";
  if (normalized === "canceled" || normalized === "cancelled") return "canceled";
  if (normalized === "no_show" || normalized === "noshow") return "noShow";

  return "fallback";
}

export function getStatusTone(status?: string | null) {
  return schedovaStatusTones[normalizeStatusTone(status)];
}

export function createSchedovaUiTheme(colors?: Partial<SchedovaUiColors>) {
  return {
    colors: {
      ...schedovaColors,
      ...colors,
    },
    spacing: schedovaSpacing,
    radii: schedovaRadii,
    typography: schedovaTypography,
    borders: schedovaBorders,
    shadows: schedovaShadows,
  };
}

export type SchedovaUiTheme = ReturnType<typeof createSchedovaUiTheme>;
