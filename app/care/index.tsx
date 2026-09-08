import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  DemoNotice,
  EmptyState,
  IdentityHeader,
  ParentCard,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { selectAttentionItems, type AttentionItem } from '@/state/attention';
import { useSessionStore } from '@/state/sessionStore';
import {
  selectParent,
  selectParentStats,
  selectUpcomingFollowUps,
  useVaultSnapshot,
} from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { describeDueDate } from '@/utils/date';
import { pluralise } from '@/utils/format';

const UPCOMING_LIMIT = 4;
const ATTENTION_PREVIEW = 3;

/**
 * The caregiver's home screen.
 *
 * Section order is the approved reference's: greeting, the family, what needs
 * attention, what is coming up, then the two shortcuts. It is ordered that way
 * because the first question is "who", not "what" — a list of tasks with no
 * person attached is how a helper ends up filing a report against the wrong
 * parent at eleven at night.
 *
 * Everything on this screen is computed from records in the vault. Nothing is
 * invented to fill a card: an empty section renders as empty, and an empty
 * attention list says there is nothing to do — never that anybody is well.
 */
export default function CaregiverHomeScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const firstName = user?.fullName?.split(' ')[0] ?? null;

  const vault = useVaultSnapshot();
  const attention = selectAttentionItems(vault);
  const upcoming = selectUpcomingFollowUps(vault, UPCOMING_LIMIT);

  const header = (
    <IdentityHeader
      name={user?.fullName ?? 'Signed in'}
      context="Family space"
      onOpenSettings={() => router.push('/settings')}
      testID="care-header"
    />
  );

  if (vault.parents.length === 0) {
    return (
      <Screen testID="care-home-empty">
        {header}
        <Greeting firstName={firstName} />
        <EmptyState
          icon="person-add-outline"
          title="Add the first person"
          message="Create a record for someone you help. You can then add their reports, note what the doctor said, and keep track of what comes next."
          actionLabel="Add a person"
          onAction={() => router.push('/parent/new')}
          testID="care-home-empty-state"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="care-home">
      {header}
      <Greeting firstName={firstName} />

      <SectionHeader
        title="Your family"
        actionLabel="Manage access"
        onAction={() => router.push('/care/family')}
        testID="care-home-family-header"
      />

      {vault.parents.map((parent) => (
        <ParentCard
          key={parent.id}
          parent={parent}
          stats={selectParentStats(vault, parent.id)}
          onPress={() => router.push(`/parent/${parent.id}`)}
          testID={`parent-card-${parent.id}`}
        />
      ))}

      <SectionHeader
        title="Needs your attention"
        subtitle={
          attention.length === 0 ? undefined : pluralise(attention.length, 'item') + ' to look at'
        }
        testID="care-home-attention-header"
      />

      {attention.length === 0 ? (
        <Card tone="quiet" testID="care-home-attention-empty">
          <Text variant="bodyStrong">Nothing is waiting for you</Text>
          {/*
            Deliberately about the paperwork, not about the person. "All clear"
            here would read as a health statement, and this screen has no idea
            whether anybody is well — only whether anything is unfiled.
          */}
          <Text variant="callout" tone="secondary" style={styles.spaced}>
            No overdue dates and no documents waiting to be checked. This is about the records, not
            about how anyone is feeling.
          </Text>
        </Card>
      ) : (
        attention
          .slice(0, ATTENTION_PREVIEW)
          .map((item) => (
            <AttentionRow
              key={item.id}
              item={item}
              parentName={selectParent(vault, item.parentId)?.fullName ?? 'Unknown record'}
              onPress={() => router.push(item.route)}
            />
          ))
      )}

      {attention.length > ATTENTION_PREVIEW ? (
        <Button
          label={`See all ${attention.length} items`}
          variant="ghost"
          size="medium"
          fullWidth={false}
          onPress={() => router.push('/care/tasks')}
          testID="care-home-attention-more"
        />
      ) : null}

      <SectionHeader
        title="Coming up"
        actionLabel="Calendar"
        onAction={() => router.push('/care/calendar')}
        testID="care-home-upcoming-header"
      />

      {upcoming.length === 0 ? (
        <Card tone="quiet" testID="care-home-upcoming-empty">
          <Text variant="callout" tone="secondary">
            Nothing is scheduled. Add a visit or a test when the date is fixed.
          </Text>
        </Card>
      ) : (
        upcoming.map((followUp) => (
          <Card
            key={followUp.id}
            tone="appointment"
            onPress={() => router.push(`/follow-up/${followUp.id}`)}
            accessibilityLabel={`${selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown record'}. ${followUp.title}. ${describeDueDate(followUp.dueDate)}.`}
            accessibilityHint="Opens this next step"
            style={styles.stacked}
            testID={`care-home-upcoming-${followUp.id}`}
          >
            <Text variant="caption" tone="secondary">
              {selectParent(vault, followUp.parentId)?.fullName ?? 'Unknown record'}
            </Text>
            <Text variant="subheading">{followUp.title}</Text>
            <Text variant="callout" style={styles.onAppointment}>
              {describeDueDate(followUp.dueDate)}
            </Text>
          </Card>
        ))
      )}

      <View style={styles.quickActions}>
        <Button
          label="Add a document"
          icon="camera-outline"
          onPress={() => router.push('/capture')}
          testID="care-home-add-document"
        />
        <Button
          label="Family to-do"
          variant="secondary"
          icon="checkmark-circle-outline"
          onPress={() => router.push('/care/tasks')}
          testID="care-home-tasks"
        />
      </View>
    </Screen>
  );
}

function Greeting({ firstName }: { firstName: string | null }): React.JSX.Element {
  return (
    <View style={styles.greeting}>
      <Text variant="title" accessibilityRole="header">
        {firstName ? `Hello, ${firstName}.` : 'Hello.'}
      </Text>
      <DemoNotice />
    </View>
  );
}

function AttentionRow({
  item,
  parentName,
  onPress,
}: {
  item: AttentionItem;
  parentName: string;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Card
      tone="appointment"
      onPress={onPress}
      accessibilityLabel={`${parentName}. ${item.title}. ${item.detail}`}
      accessibilityHint="Opens the item that needs attention"
      style={styles.stacked}
      testID={`care-home-attention-${item.id}`}
    >
      <Text variant="caption" tone="secondary">
        {parentName}
      </Text>
      <Text variant="subheading">{item.title}</Text>
      <Text variant="callout" style={styles.onAppointment}>
        {item.detail}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  greeting: { gap: spacing.sm, paddingTop: spacing.lg },
  // Peach is a surface, not a status, so the text on it says what it means.
  onAppointment: { color: colors.onSurfaceAppointment },
  quickActions: { gap: spacing.md, marginTop: spacing.xxxl },
  spaced: { marginTop: spacing.xs },
  stacked: { gap: spacing.xxs, marginBottom: spacing.md },
});
