export function shouldShowFirstBookingActivationCard(
  appointmentCount: number,
) {
  return appointmentCount <= 0;
}

export function getDashboardBookingEntryRoute(appointmentCount: number) {
  return shouldShowFirstBookingActivationCard(appointmentCount)
    ? "/quick-start"
    : "/book-appointment";
}
