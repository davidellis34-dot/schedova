import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  DEFAULT_COUNTRY_REGION,
  type CountryRegionCode,
  isCountryRegionCode,
  normalizePhoneForSms,
} from "./phoneNumbers";
import { supabase } from "./supabase";

const COUNTRY_REGION_STORAGE_KEY = "schedova_country_region_v1";

async function getLocalCountryRegion() {
  const stored = await AsyncStorage.getItem(COUNTRY_REGION_STORAGE_KEY);
  return isCountryRegionCode(stored) ? stored : null;
}

async function setLocalCountryRegion(countryRegion: CountryRegionCode) {
  await AsyncStorage.setItem(COUNTRY_REGION_STORAGE_KEY, countryRegion);
}

async function getCurrentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

export async function hasSelectedUserCountryRegion() {
  const userId = await getCurrentUserId();

  if (userId) {
    const { data, error } = await supabase
      .from("user_settings")
      .select("country_region")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && isCountryRegionCode(data?.country_region)) {
      await setLocalCountryRegion(data.country_region);
      return true;
    }
  }

  return Boolean(await getLocalCountryRegion());
}

export async function getUserCountryRegion(): Promise<CountryRegionCode> {
  const userId = await getCurrentUserId();

  if (userId) {
    const { data, error } = await supabase
      .from("user_settings")
      .select("country_region")
      .eq("user_id", userId)
      .maybeSingle();

    if (!error && isCountryRegionCode(data?.country_region)) {
      await setLocalCountryRegion(data.country_region);
      return data.country_region;
    }
  }

  return (await getLocalCountryRegion()) || DEFAULT_COUNTRY_REGION;
}

export async function saveUserCountryRegion(countryRegion: CountryRegionCode) {
  await setLocalCountryRegion(countryRegion);

  const userId = await getCurrentUserId();
  if (!userId) return { savedToDatabase: false };

  const { error } = await supabase.from("user_settings").upsert({
    user_id: userId,
    country_region: countryRegion,
    updated_at: new Date().toISOString(),
  });

  return { savedToDatabase: !error, error };
}

export async function normalizePhoneForSmsWithUserDefault(
  value: string | null | undefined,
) {
  return normalizePhoneForSms(value, await getUserCountryRegion());
}
