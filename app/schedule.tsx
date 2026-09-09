import { Redirect } from 'expo-router';

import { useExperience } from '@/services/experience';

/**
 * The old follow-ups tab.
 *
 * `/schedule` was a tab in the previous three-tab shell. It is kept as a
 * redirect because it is reachable from anything already installed — a deep
 * link, a notification, somebody's muscle memory — and because both experiences
 * still have somewhere for it to mean: the caregiver's To-do tab, or the
 * parent's own list under My health.
 */
export default function ScheduleRedirect(): React.JSX.Element {
  const { experience } = useExperience();
  return <Redirect href={experience === 'parent' ? '/me/health' : '/care/tasks'} />;
}
