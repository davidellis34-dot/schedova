import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

async function readSecureStoreItem(key: string) {
  try {
    return await SecureStore.getItemAsync(key);
  } catch (error) {
    if (__DEV__) {
      console.log("[AuthStorage] SecureStore read failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return null;
  }
}

async function writeSecureStoreItem(key: string, value: string) {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch (error) {
    if (__DEV__) {
      console.log("[AuthStorage] SecureStore write failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function deleteSecureStoreItem(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch (error) {
    if (__DEV__) {
      console.log("[AuthStorage] SecureStore delete failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const supabaseAuthStorage = {
  async getItem(key: string) {
    const secureValue = await readSecureStoreItem(key);

    if (typeof secureValue === "string") {
      return secureValue;
    }

    const asyncStorageValue = await AsyncStorage.getItem(key);

    if (typeof asyncStorageValue === "string") {
      await writeSecureStoreItem(key, asyncStorageValue);
    }

    return asyncStorageValue;
  },
  async setItem(key: string, value: string) {
    await AsyncStorage.setItem(key, value);
    await writeSecureStoreItem(key, value);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await deleteSecureStoreItem(key);
  },
};
