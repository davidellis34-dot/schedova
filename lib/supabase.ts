import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import "react-native-url-polyfill/auto";

const supabaseUrl = "https://tzbnnmjogxidyltanufu.supabase.co";
const supabaseAnonKey =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR6Ym5ubWpvZ3hpZHlsdGFudWZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMDQ0OTAsImV4cCI6MjA5MzY4MDQ5MH0.UdUli3NBVHl0dpOEdP7l4VemboeCuz9WztvxGoVMdkg";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
