import { createClient, processLock } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";
import { supabaseAuthStorage } from "./supabaseStorage";

export const supabaseUrl = "https://tzbnnmjogxidyltanufu.supabase.co";
export const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Ym5ubWpvZ3hpZHlsdGFudWZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMDQ0OTAsImV4cCI6MjA5MzY4MDQ5MH0.UdUli3NBVHl0dpOEdP7l4VemboeCuz9WztvxGoVMdkg";
export const supabaseAuthStorageKey = "sb-tzbnnmjogxidyltanufu-auth-token";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: supabaseAuthStorage,
    storageKey: supabaseAuthStorageKey,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    lock: processLock,
  },
});
