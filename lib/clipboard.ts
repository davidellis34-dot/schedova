import { NativeModulesProxy } from "expo-modules-core";
import { Platform } from "react-native";

function isExpoClipboardAvailable() {
  if (Platform.OS === "web") return true;

  const expoGlobal = (
    globalThis as typeof globalThis & {
      expo?: { modules?: Record<string, unknown> };
    }
  ).expo;

  return Boolean(
    expoGlobal?.modules?.ExpoClipboard || NativeModulesProxy?.ExpoClipboard,
  );
}

export async function copyTextToClipboard(text: string) {
  if (!isExpoClipboardAvailable()) {
    throw new Error("Clipboard is unavailable in this build.");
  }

  try {
    const Clipboard = await import("expo-clipboard");

    if (typeof Clipboard.setStringAsync !== "function") {
      throw new Error("Clipboard is unavailable in this build.");
    }

    await Clipboard.setStringAsync(text);
  } catch {
    throw new Error("Clipboard is unavailable in this build.");
  }
}
