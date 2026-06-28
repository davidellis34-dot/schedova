export const MESSAGE_PACK_PRODUCT_CREDITS = {
  message_pack_100: 100,
  message_pack_250: 250,
  message_pack_500: 500,
} as const;

export type MessagePackProductId = keyof typeof MESSAGE_PACK_PRODUCT_CREDITS;

export const MESSAGE_PACK_PRODUCT_IDS = Object.keys(
  MESSAGE_PACK_PRODUCT_CREDITS,
) as MessagePackProductId[];

export function isMessagePackProductId(
  value: unknown,
): value is MessagePackProductId {
  return (
    typeof value === "string" &&
    value in MESSAGE_PACK_PRODUCT_CREDITS
  );
}

export function getMessagePackCredits(productId: unknown) {
  if (!isMessagePackProductId(productId)) return 0;
  return MESSAGE_PACK_PRODUCT_CREDITS[productId];
}

export function getMessagePackLabel(productId: unknown) {
  const credits = getMessagePackCredits(productId);
  return credits > 0 ? `${credits} SMS credits` : "SMS credit pack";
}
