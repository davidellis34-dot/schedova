type SmsSettingsReviewError = {
  code?: string | null;
  details?: string | null;
  hint?: string | null;
  message?: string | null;
};

type PersistSmsSettingsReviewInput = {
  authStatus: string;
  userId?: string | null;
  reviewedAt?: string;
  onError?: (error: SmsSettingsReviewError) => void;
  runUpdate?: (input: {
    reviewedAt: string;
    userId: string;
  }) => Promise<{ error?: SmsSettingsReviewError | null }>;
};

async function defaultPersistSmsSettingsReviewUpdate(input: {
  reviewedAt: string;
  userId: string;
}) {
  const { supabase } = await import("./supabase");

  return supabase
    .from("businesses")
    .update({
      sms_settings_reviewed_at: input.reviewedAt,
    })
    .eq("user_id", input.userId)
    .is("sms_settings_reviewed_at", null);
}

export async function persistSmsSettingsReview(
  input: PersistSmsSettingsReviewInput,
) {
  if (input.authStatus !== "authenticated" || !input.userId) {
    return false;
  }

  const runUpdate =
    input.runUpdate || defaultPersistSmsSettingsReviewUpdate;
  const result = await runUpdate({
    reviewedAt: input.reviewedAt || new Date().toISOString(),
    userId: input.userId,
  });

  if (result.error) {
    input.onError?.(result.error);
    return false;
  }

  return true;
}
