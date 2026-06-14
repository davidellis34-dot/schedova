export type CountryRegionCode = "US" | "CA" | "GB" | "AU";

export type CountryRegion = {
  code: CountryRegionCode;
  name: string;
  callingCode: string;
};

export const DEFAULT_COUNTRY_REGION: CountryRegionCode = "US";

export const COUNTRY_REGIONS: CountryRegion[] = [
  { code: "US", name: "United States", callingCode: "+1" },
  { code: "CA", name: "Canada", callingCode: "+1" },
  { code: "GB", name: "United Kingdom", callingCode: "+44" },
  { code: "AU", name: "Australia", callingCode: "+61" },
];

export function getCountryRegion(
  code: string | null | undefined,
): CountryRegion {
  return (
    COUNTRY_REGIONS.find((region) => region.code === code) ||
    COUNTRY_REGIONS[0]
  );
}

export function isCountryRegionCode(
  code: string | null | undefined,
): code is CountryRegionCode {
  return COUNTRY_REGIONS.some((region) => region.code === code);
}

export function getCountryRegionLabel(code: string | null | undefined) {
  const region = getCountryRegion(code);
  return `${region.name} ${region.callingCode}`;
}

export function normalizePhoneForSms(
  value: string | null | undefined,
  countryRegionCode: CountryRegionCode = DEFAULT_COUNTRY_REGION,
) {
  const trimmed = String(value || "").trim();

  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed;

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return trimmed;

  const region = getCountryRegion(countryRegionCode);
  const callingCodeDigits = region.callingCode.replace(/\D/g, "");

  if (
    digits.startsWith(callingCodeDigits) &&
    digits.length > callingCodeDigits.length + 4
  ) {
    return `+${digits}`;
  }

  if ((region.code === "US" || region.code === "CA") && digits.length === 10) {
    return `+1${digits}`;
  }

  const localDigits =
    region.code === "GB" || region.code === "AU"
      ? digits.replace(/^0+/, "")
      : digits;

  return `${region.callingCode}${localDigits}`;
}
