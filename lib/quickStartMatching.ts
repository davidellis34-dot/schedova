export type QuickStartClient = {
  id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  archived_at?: string | null;
};

export type QuickStartService = {
  id: string;
  name?: string | null;
  price?: number | string | null;
  duration_minutes?: number | string | null;
  color_hex?: string | null;
};

export function normalizeQuickStartId(value: unknown) {
  return value == null ? "" : String(value);
}

export function quickStartNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedName(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

function phoneDigits(value: unknown) {
  return String(value || "").replace(/[^\d]/g, "");
}

export function findReusableQuickStartClient(input: {
  clients: QuickStartClient[];
  selectedClientId?: string;
  name: string;
  phone: string;
}) {
  const selected = input.clients.find(
    (client) =>
      normalizeQuickStartId(client.id) ===
      normalizeQuickStartId(input.selectedClientId),
  );
  if (selected) return selected;

  const matchingName = input.clients.filter(
    (client) => normalizedName(client.name) === normalizedName(input.name),
  );
  if (matchingName.length !== 1) return null;

  const matchedClient = matchingName[0];
  if (
    input.phone &&
    phoneDigits(matchedClient.phone) !== phoneDigits(input.phone)
  ) {
    return null;
  }

  return matchedClient;
}

export function findReusableQuickStartService(input: {
  services: QuickStartService[];
  selectedServiceId?: string;
  name: string;
  price: number;
  duration: number;
}) {
  const selected = input.services.find(
    (service) =>
      normalizeQuickStartId(service.id) ===
      normalizeQuickStartId(input.selectedServiceId),
  );
  if (selected) return selected;

  return (
    input.services.find(
      (service) =>
        normalizedName(service.name) === normalizedName(input.name) &&
        quickStartNumber(service.price, 0) === input.price &&
        quickStartNumber(service.duration_minutes, 30) === input.duration,
    ) || null
  );
}
