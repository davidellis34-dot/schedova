import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Alert } from "react-native";

export const SUPPORT_EMAIL = "support@schedova.com";
export const WEBSITE_URL = "https://schedova.com";
export const PRIVACY_POLICY_PATH = "/privacy-policy/";
export const DELETE_ACCOUNT_PATH = "/delete-account/";
export const TERMS_OF_USE_PATH = "/terms/";
export const APPLE_STANDARD_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
export const SUPPORT_URL =
  "mailto:support@schedova.com?subject=Schedova%20Support%20Request";
export const ACCOUNT_DELETION_SUPPORT_INSTRUCTION =
  "Permanently delete your Schedova account and data from inside the app.";
export const PRIVACY_POLICY_URL = `${WEBSITE_URL}${PRIVACY_POLICY_PATH}`;
export const DELETE_ACCOUNT_URL = `${WEBSITE_URL}${DELETE_ACCOUNT_PATH}`;
export const TERMS_OF_USE_URL = APPLE_STANDARD_EULA_URL;

function isValidWebsiteUrl(url: string) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === "https:" || parsedUrl.protocol === "http:";
  } catch {
    return false;
  }
}

export async function openExternalWebsite(title: string, url: string) {
  if (!isValidWebsiteUrl(url)) {
    Alert.alert(title, url);
    return;
  }

  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    Alert.alert(title, url);
  }
}

export async function openSupportEmail() {
  try {
    const canOpen = await Linking.canOpenURL(SUPPORT_URL);

    if (!canOpen) {
      Alert.alert("Contact Support", SUPPORT_EMAIL);
      return;
    }

    await Linking.openURL(SUPPORT_URL);
  } catch {
    Alert.alert("Contact Support", SUPPORT_EMAIL);
  }
}
