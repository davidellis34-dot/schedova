export type AuthenticatedAppBaseRoute =
  | "/dashboard"
  | "/onboarding"
  | "/walkthrough";

export function resolveAuthenticatedAppBaseRoute(input: {
  onboardingCompleted: boolean;
  onboardingStarted: boolean;
  walkthroughCompleted: boolean;
  walkthroughStarted: boolean;
  hasExistingBusinessProfile: boolean;
}): AuthenticatedAppBaseRoute {
  const canUseExistingBusinessFallback =
    !input.onboardingStarted && !input.walkthroughStarted;
  const hasCompletedSetup =
    input.onboardingCompleted ||
    (canUseExistingBusinessFallback && input.hasExistingBusinessProfile);

  if (hasCompletedSetup) {
    return "/dashboard";
  }

  return input.walkthroughCompleted ? "/onboarding" : "/walkthrough";
}
