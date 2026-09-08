import { StyleSheet } from 'react-native';

import { Callout, Card, EmptyState, Screen, SectionHeader, Text } from '@/components';
import { useExperience } from '@/services/experience';
import { selectParent, useVaultSnapshot } from '@/state/vaultStore';
import { spacing } from '@/theme';

/**
 * Who can see this parent's record, and how to stop them.
 *
 * The reference shows a single "Share my record" checkbox. That control cannot
 * ship in this form: sharing a health record is a grant to a named account with
 * a stated scope, and a checkbox with no grantee behind it would tell somebody
 * their record was private when the question of who could read it had never
 * been asked.
 *
 * So this screen names what is true right now — no grants exist, so nobody has
 * access — and the real thing lands with KOO-03: named helpers, exact
 * permissions, pending invitations, and withdrawal.
 */
export default function ParentFamilyScreen(): React.JSX.Element {
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();
  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);

  if (record === undefined) {
    return (
      <Screen testID="me-family-empty">
        <EmptyState
          icon="people-outline"
          title="Your record is not set up yet"
          message="Once your own health record exists, this is where you decide who may see it."
          testID="me-family-empty-state"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="me-family">
      <SectionHeader
        title="My family helper"
        subtitle="Who can see your record"
        testID="me-family-header"
      />

      <Card tone="quiet" style={styles.card} testID="me-family-nobody">
        <Text variant="heading">Nobody has access</Text>
        <Text variant="callout" tone="secondary">
          Your record is only on your own account. No helper can open it, and none has been invited.
        </Text>
      </Card>

      <Callout
        tone="neutral"
        title="Inviting a helper is being built"
        message="When it arrives you will invite one person at a time, choose whether they can only read or also add things, see exactly what they have opened, and take that access back whenever you want."
        testID="me-family-notice"
      />

      <SectionHeader title="My profile" testID="me-family-profile-header" />
      <Card style={styles.card} testID="me-family-profile">
        <Text variant="bodyStrong">{record.fullName}</Text>
        <Text variant="callout" tone="secondary">
          This is your own record. Everything added to it shows who added it and when.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.xs, marginBottom: spacing.md },
});
