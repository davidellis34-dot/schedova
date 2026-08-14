export type FirstBookingActivationRoute = "/dashboard" | "/onboarding";

export function resolveFirstBookingActivationRoute(input: {
  hasExistingAppointment: boolean;
  activationHandled: boolean;
}): FirstBookingActivationRoute {
  if (input.hasExistingAppointment || input.activationHandled) {
    return "/dashboard";
  }

  return "/onboarding";
}

export function shouldRequireCountryRegionBeforeRoute(
  route: FirstBookingActivationRoute,
) {
  return route === "/dashboard";
}
