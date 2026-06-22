export type SchedovaBookingLinkInput = {
  clientId?: string | null;
  date?: string | null;
  time?: string | null;
  serviceId?: string | null;
  source?: string | null;
};

export type SchedovaBookingRouteParams = {
  appointmentDate?: string;
  appointmentTime?: string;
  clientId?: string;
  serviceId?: string;
  source?: string;
  endTime?: string;
  title?: string;
  notes?: string;
};

function addQueryParam(
  params: string[],
  key: string,
  value: string | null | undefined,
) {
  const cleanValue = String(value || "").trim();

  if (!cleanValue) return;

  params.push(`${encodeURIComponent(key)}=${encodeURIComponent(cleanValue)}`);
}

export function buildSchedovaBookingLink({
  clientId,
  date,
  time,
  serviceId,
  source = "message",
}: SchedovaBookingLinkInput) {
  const params: string[] = [];

  addQueryParam(params, "date", date);
  addQueryParam(params, "time", time);
  addQueryParam(params, "clientId", clientId);
  addQueryParam(params, "serviceId", serviceId);
  addQueryParam(params, "source", source);

  return `schedova://book${params.length ? `?${params.join("&")}` : ""}`;
}

function readSearchParam(url: URL, key: string) {
  const value = url.searchParams.get(key);
  return value?.trim() || undefined;
}

export function getSchedovaBookingRouteParamsFromUrl(
  rawUrl: string,
): SchedovaBookingRouteParams | null {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return null;
  }

  const isSchedovaScheme = parsedUrl.protocol === "schedova:";
  const isSchedovaWeb =
    parsedUrl.protocol === "https:" &&
    parsedUrl.hostname.toLowerCase() === "schedova.com";

  if (!isSchedovaScheme && !isSchedovaWeb) return null;

  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname.toLowerCase().replace(/\/+$/, "");
  const isBookRoute =
    host === "book" ||
    path === "/book" ||
    path === "/app/book" ||
    `${host}${path}` === "app/book";

  if (!isBookRoute) return null;

  const date = readSearchParam(parsedUrl, "date");
  const time = readSearchParam(parsedUrl, "time");
  const clientId = readSearchParam(parsedUrl, "clientId");
  const serviceId = readSearchParam(parsedUrl, "serviceId");
  const source = readSearchParam(parsedUrl, "source") || "deeplink";
  const endTime = readSearchParam(parsedUrl, "endTime");
  const title = readSearchParam(parsedUrl, "title");
  const notes = readSearchParam(parsedUrl, "notes");

  const routeParams: SchedovaBookingRouteParams = { source };

  if (date) routeParams.appointmentDate = date;
  if (time) routeParams.appointmentTime = time;
  if (clientId) routeParams.clientId = clientId;
  if (serviceId) routeParams.serviceId = serviceId;
  if (endTime) routeParams.endTime = endTime;
  if (title) routeParams.title = title;
  if (notes) routeParams.notes = notes;

  return routeParams;
}

// Future: support public booking links using https://schedova.com/book/...
// after a real client self-booking portal exists.
