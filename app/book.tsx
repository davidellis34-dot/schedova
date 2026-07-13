import { Redirect, useLocalSearchParams } from "expo-router";

export default function BookRedirectScreen() {
  const params = useLocalSearchParams();

  return (
    <Redirect
      href={{
        pathname: "/book-appointment",
        params,
      }}
    />
  );
}
