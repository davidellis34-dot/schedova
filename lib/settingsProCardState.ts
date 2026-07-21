export type SettingsProCardStatus = "checking" | "active" | "inactive";

type SettingsProCardInput = {
  // Null means this account has not received a confirmed entitlement result yet.
  confirmedIsPro: boolean | null;
  isRefreshing?: boolean;
};

export function resolveSettingsProCardState({
  confirmedIsPro,
}: SettingsProCardInput) {
  if (confirmedIsPro === null) {
    return {
      status: "checking" as const,
      subtitle: "Checking subscription...",
      badgeLabel: null,
    };
  }

  if (confirmedIsPro) {
    return {
      status: "active" as const,
      subtitle: "Pro active",
      badgeLabel: "Manage",
    };
  }

  return {
    status: "inactive" as const,
    subtitle: "No subscription",
    badgeLabel: "Upgrade",
  };
}
