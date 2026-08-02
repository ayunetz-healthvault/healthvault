import { Redirect } from 'expo-router';

/**
 * Entry point. The route guard in `_layout.tsx` handles the onboarding, auth
 * and lock cases, so anything that reaches here belongs on the dashboard.
 */
export default function Index(): React.JSX.Element {
  return <Redirect href="/(tabs)" />;
}
