export const CLIENT_TAGS = ["New", "Regular", "VIP"] as const;

export type ClientTag = (typeof CLIENT_TAGS)[number];

export function normalizeClientTag(value: unknown): ClientTag {
  return CLIENT_TAGS.includes(value as ClientTag)
    ? (value as ClientTag)
    : "New";
}
