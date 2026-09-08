import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { useAccessStore } from '@/state/accessStore';
import { countAttentionItems } from '@/state/attention';
import { useVaultSnapshot } from '@/state/vaultStore';
import { ROLE_DESCRIPTIONS } from '@/types/access';
import { spacing } from '@/theme';
import { RELATIONSHIP_LABELS } from '@/types/labels';
import { calculateAge } from '@/utils/date';
import { pluralise } from '@/utils/format';

/**
 * Who the caregiver helps, and on what terms.
 *
 * The reference calls this "Family & access", and the second half of that name
 * is the point: this is where the permission a helper holds over each record is
 * stated in words, not implied by the fact that they can see it.
 *
 * The permission text below is deliberately provisional. Until KOO-03 there is
 * no grant model — every record here is one this account created and holds
 * outright — and saying so plainly is more useful than showing a permission
 * control that does not yet control anything.
 */
export default function CaregiverFamilyScreen(): React.JSX.Element {
  const router = useRouter();
  const vault = useVaultSnapshot();
  const roles = useAccessStore((state) => state.roles);

  return (
    <Screen testID="care-family">
      <SectionHeader
        title="Family & access"
        subtitle="Who you help, and what you can see"
        testID="care-family-header"
      />

      {vault.parents.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="Nobody yet"
          message="Add a record for someone you help, or ask them to invite you to theirs."
          actionLabel="Add a person"
          onAction={() => router.push('/parent/new')}
          testID="care-family-empty"
        />
      ) : (
        vault.parents.map((parent) => {
          const age = calculateAge(parent.dateOfBirth);
          const attentionCount = countAttentionItems(vault, parent.id);
          const role = roles[parent.id] ?? null;

          return (
            <Card key={parent.id} style={styles.card} testID={`care-family-${parent.id}`}>
              <View style={styles.row}>
                <Avatar name={parent.fullName} color={parent.avatarColor} size={52} />
                <View style={styles.grow}>
                  <Text variant="subheading" numberOfLines={1}>
                    {parent.fullName}
                  </Text>
                  <Text variant="caption" tone="secondary">
                    {[RELATIONSHIP_LABELS[parent.relationship], age === null ? null : `${age} years`]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
              </View>

              <Badge
                label={ROLE_DESCRIPTIONS[role ?? 'manager'].label}
                tone="brand"
                icon="shield-checkmark-outline"
                testID={`care-family-role-${parent.id}`}
              />

              <Text variant="caption" tone="secondary">
                {role === null
                  ? // Not "read-only" and not "full access": an unknown role
                    // rendered as either one is wrong in a way the user cannot
                    // see. Saying it is unknown is the honest answer.
                    'Checking what you can do with this record…'
                  : ROLE_DESCRIPTIONS[role].detail}
              </Text>

              <Text variant="callout" tone="secondary" style={styles.spaced}>
                {attentionCount === 0
                  ? 'Nothing is waiting on this record.'
                  : `${pluralise(attentionCount, 'item')} to look at.`}
              </Text>

              <Button
                label="Open record"
                variant="secondary"
                size="medium"
                onPress={() => router.push(`/parent/${parent.id}`)}
                testID={`care-family-open-${parent.id}`}
              />
            </Card>
          );
        })
      )}

      <Callout
        tone="info"
        title="How access works"
        /*
          Stated plainly, because the model is not obvious and getting it wrong
          is how a helper believes a parent has a login when they do not.
        */
        message="A person can only reach a record once they have their own account and that account has been given access. Open a record and use its Family screen to invite somebody or take their access back."
        testID="care-family-sharing-notice"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, marginBottom: spacing.md },
  grow: { flex: 1 },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  spaced: { marginTop: spacing.xs },
});
