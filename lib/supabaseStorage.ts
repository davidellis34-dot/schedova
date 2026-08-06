import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

const AUTH_STORAGE_MIGRATION_VERSION = "2";
const AUTH_STORAGE_MIGRATION_KEY_PREFIX =
  "schedova_auth_storage_migration_version:";
const legacyStorageMigrations = new Map<string, Promise<void>>();

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

async function deleteSecureStoreItem(key: string) {
  try {
    await SecureStore.deleteItemAsync(key);
    return true;
  } catch (error) {
    if (__DEV__) {
      console.log("[AuthStorage] SecureStore delete failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return false;
  }
}

async function migrateLegacySecureStoreSession(key: string) {
  const existingMigration = legacyStorageMigrations.get(key);
  if (existingMigration) {
    return existingMigration;
  }

  const migration = (async () => {
    const migrationKey = `${AUTH_STORAGE_MIGRATION_KEY_PREFIX}${key}`;
    const completedVersion = await AsyncStorage.getItem(migrationKey);
    if (completedVersion === AUTH_STORAGE_MIGRATION_VERSION) {
      return;
    }

    // AsyncStorage is the canonical location. If a legacy-only install still
    // has a valid SecureStore session, copy it before deleting the stale copy.
    const asyncStorageValue = await AsyncStorage.getItem(key);
    const secureStoreValue = await readSecureStoreItem(key);
    let migratedSecureStoreSession = false;

    if (asyncStorageValue === null && typeof secureStoreValue === "string") {
      await AsyncStorage.setItem(key, secureStoreValue);
      const persistedValue = await AsyncStorage.getItem(key);
      if (persistedValue !== secureStoreValue) {
        throw new Error("AsyncStorage session migration could not be verified.");
      }
      migratedSecureStoreSession = true;
    }

    // Remove every legacy SecureStore copy, including a stale one that differs
    // from the valid AsyncStorage session for the currently signed-in account.
    const removedLegacyCopy = await deleteSecureStoreItem(key);
    if (!removedLegacyCopy) {
      throw new Error("SecureStore session cleanup could not be verified.");
    }
    await AsyncStorage.setItem(migrationKey, AUTH_STORAGE_MIGRATION_VERSION);

    if (__DEV__) {
      console.log("[AuthStorage] legacy session migration completed", {
        migratedSecureStoreSession,
      });
    }
  })().catch((error) => {
    if (__DEV__) {
      console.log("[AuthStorage] legacy session migration failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  legacyStorageMigrations.set(key, migration);
  return migration;
}

export const supabaseAuthStorage = {
  async getItem(key: string) {
    await migrateLegacySecureStoreSession(key);
    const asyncStorageValue = await AsyncStorage.getItem(key);

    // Supabase sessions exceed SecureStore's documented payload limit on some
    // Android devices. AsyncStorage is the canonical full-session store so a
    // failed SecureStore write can never revive a previous account's session.
    if (typeof asyncStorageValue === "string") {
      return asyncStorageValue;
    }

    return null;
  },
  async setItem(key: string, value: string) {
    await migrateLegacySecureStoreSession(key);
    await AsyncStorage.setItem(key, value);
    // Keep a single canonical session copy. Duplicate SecureStore sessions can
    // outlive sign-out and resurrect the prior account after an app update.
    await deleteSecureStoreItem(key);
  },
  async removeItem(key: string) {
    await AsyncStorage.removeItem(key);
    await deleteSecureStoreItem(key);
  },
};
