import { Redirect } from 'expo-router';

import { homeRouteFor, useExperience } from '@/services/experience';

/**
 * Entry point.
 *
 * The route guard in `_layout.tsx` handles the onboarding, auth and lock cases,
 * so anything reaching here is signed in and unlocked. All that is left is
 * which of the two homes it belongs on — derived from the account's records,
 * never chosen. See `resolveExperience`.
 */
export default function Index(): React.JSX.Element {
  const { experience } = useExperience();
  return <Redirect href={homeRouteFor(experience)} />;
}
