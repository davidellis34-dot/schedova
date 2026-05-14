import { supabase } from "./supabase";

export async function sendTextReminder(to: string, message: string) {
  const { data, error } = await supabase.functions.invoke("rapid-action", {
    body: {
      to,
      message,
    },
  });

  if (error) {
    console.log("SMS error:", error);
    throw error;
  }

  return data;
}
