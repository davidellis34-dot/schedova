export type EntryType =
  | "appointment"
  | "blocked_time"
  | "vacation"
  | "personal";

export type Client = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  user_id?: string | null;
  sms_opt_in?: boolean | null;
  sms_opt_in_at?: string | null;
  sms_opt_in_source?: string | null;
};

export type Service = {
  id: string;
  name: string;
  price?: number;
  duration_minutes?: number;
  color_hex?: string;
};

export type ThemeColors = {
  background: string;
  card: string;
  text: string;
  mutedText: string;
  border: string;
  primary: string;
};
