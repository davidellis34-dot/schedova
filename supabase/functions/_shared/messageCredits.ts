type JsonRecord = Record<string, unknown>;

type MessageCreditRpcResult = JsonRecord & {
  ok?: boolean;
  reason?: string;
  balance?: number;
  eventId?: string;
  creditsAdded?: number;
};

function normalizeRpcResult(data: unknown): MessageCreditRpcResult {
  return data && typeof data === "object"
    ? (data as MessageCreditRpcResult)
    : {};
}

export async function claimMessagePackPurchase(
  serviceClient: any,
  payload: {
    userId: string;
    productId: string;
    transactionId: string;
    purchaseToken?: string | null;
    purchasedAt?: string | null;
    appUserId?: string | null;
    originalAppUserId?: string | null;
    store?: string | null;
    rawTransaction?: unknown;
  },
) {
  const { data, error } = await serviceClient.rpc("claim_message_pack_purchase", {
    p_user_id: payload.userId,
    p_product_id: payload.productId,
    p_revenuecat_transaction_id: payload.transactionId,
    p_revenuecat_purchase_token: payload.purchaseToken ?? null,
    p_purchased_at: payload.purchasedAt ?? null,
    p_revenuecat_app_user_id: payload.appUserId ?? null,
    p_revenuecat_original_app_user_id: payload.originalAppUserId ?? null,
    p_store: payload.store ?? null,
    p_raw_transaction:
      payload.rawTransaction && typeof payload.rawTransaction === "object"
        ? payload.rawTransaction
        : {},
  });

  return {
    data: normalizeRpcResult(data),
    error,
  };
}

export async function reserveMessageCredit(
  serviceClient: any,
  payload: {
    userId: string;
    appointmentId?: string | null;
    clientId?: string | null;
    messageType?: string | null;
    smsMessageLogId?: string | null;
    reason?: string | null;
    metadata?: unknown;
  },
) {
  const { data, error } = await serviceClient.rpc("reserve_message_credit", {
    p_user_id: payload.userId,
    p_appointment_id: payload.appointmentId ?? null,
    p_client_id: payload.clientId ?? null,
    p_message_type: payload.messageType ?? null,
    p_sms_message_log_id: payload.smsMessageLogId ?? null,
    p_reason: payload.reason ?? null,
    p_metadata:
      payload.metadata && typeof payload.metadata === "object"
        ? payload.metadata
        : {},
  });

  return {
    data: normalizeRpcResult(data),
    error,
  };
}

export async function confirmMessageCreditReservation(
  serviceClient: any,
  payload: {
    eventId: string;
    smsMessageLogId?: string | null;
  },
) {
  const { data, error } = await serviceClient.rpc(
    "confirm_message_credit_reservation",
    {
      p_event_id: payload.eventId,
      p_sms_message_log_id: payload.smsMessageLogId ?? null,
    },
  );

  return {
    data: normalizeRpcResult(data),
    error,
  };
}

export async function refundMessageCreditReservation(
  serviceClient: any,
  payload: {
    eventId: string;
    refundReason?: string | null;
    smsMessageLogId?: string | null;
  },
) {
  const { data, error } = await serviceClient.rpc(
    "refund_message_credit_reservation",
    {
      p_event_id: payload.eventId,
      p_refund_reason: payload.refundReason ?? null,
      p_sms_message_log_id: payload.smsMessageLogId ?? null,
    },
  );

  return {
    data: normalizeRpcResult(data),
    error,
  };
}
