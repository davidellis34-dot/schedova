export type AuthenticatedAppBaseRoute =
  | "/dashboard"
  | "/onboarding"
  | "/walkthrough";

export function shouldUseExistingBusinessProfileFallback(input: {
  onboardingCompleted: boolean;
  onboardingStarted: boolean;
  walkthroughCompleted: boolean;
  walkthroughStarted: boolean;
}) {
  if (input.onboardingCompleted) {
    return false;
  }

  if (input.onboardingStarted) {
    return false;
  }

  if (input.walkthroughCompleted || input.walkthroughStarted) {
    return false;
  }

  return true;
}

export function resolveAuthenticatedAppBaseRoute(input: {
  onboardingCompleted: boolean;
  onboardingStarted: boolean;
  walkthroughCompleted: boolean;
  walkthroughStarted: boolean;
  hasExistingBusinessProfile: boolean;
}): AuthenticatedAppBaseRoute {
  const canUseExistingBusinessFallback =
    shouldUseExistingBusinessProfileFallback(input);
  const hasCompletedSetup =
    input.onboardingCompleted ||
    (canUseExistingBusinessFallback && input.hasExistingBusinessProfile);

  if (hasCompletedSetup) {
    return "/dashboard";
  }

  return input.walkthroughCompleted ? "/onboarding" : "/walkthrough";
}
