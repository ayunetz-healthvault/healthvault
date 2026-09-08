import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import {
  Callout,
  Card,
  DocumentCard,
  EmptyState,
  FollowUpCard,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { useExperience } from '@/services/experience';
import {
  selectDocumentTimeline,
  selectFollowUpsForParent,
  selectParent,
  useVaultSnapshot,
} from '@/state/vaultStore';
import { spacing } from '@/theme';
import { calculateAge } from '@/utils/date';

/** How many of each list the summary screen shows before "see all". */
const PREVIEW = 3;

/**
 * "My health": everything about the parent's own record, without crowding
 * Today.
 *
 * Four groups, in the order the reference sets: documents, confirmed medicines,
 * notes and symptoms, and to-do. Two of them have no model yet — confirmed
 * medicines land with KOO-10, observations with KOO-11 — and each says so in
 * words rather than showing an empty list that looks like a list of nothing.
 */
export default function ParentHealthScreen(): React.JSX.Element {
  const router = useRouter();
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();

  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);

  if (record === undefined) {
    return (
      <Screen testID="me-health-empty">
        <EmptyState
          icon="heart-outline"
          title="Your record is not set up yet"
          message="Your documents, medicines and notes will be here once your own health record exists."
          testID="me-health-empty-state"
        />
      </Screen>
    );
  }

  const documents = selectDocumentTimeline(vault, record.id);
  const followUps = selectFollowUpsForParent(vault, record.id).filter(
    (item) => item.status === 'scheduled',
  );
  const age = calculateAge(record.dateOfBirth);

  return (
    <Screen testID="me-health">
      <SectionHeader
        title="My health"
        subtitle={[record.fullName, age === null ? null : `${age} years`]
          .filter(Boolean)
          .join(' · ')}
        testID="me-health-header"
      />

      <SectionHeader
        title="Documents"
        actionLabel={documents.length > PREVIEW ? 'See all' : undefined}
        onAction={
          documents.length > PREVIEW ? () => router.push(`/parent/${record.id}`) : undefined
        }
        testID="me-health-documents-header"
      />

      {documents.length === 0 ? (
        <Card tone="quiet" testID="me-health-documents-empty">
          <Text variant="callout" tone="secondary">
            No documents yet. Add a report or prescription and it will be kept here.
          </Text>
        </Card>
      ) : (
        documents
          .slice(0, PREVIEW)
          .map((document) => (
            <DocumentCard
              key={document.id}
              document={document}
              onPress={() => router.push(`/document/${document.id}`)}
              testID={`me-health-document-${document.id}`}
            />
          ))
      )}

      <SectionHeader title="Medicines" testID="me-health-medicines-header" />
      <Callout
        tone="neutral"
        title="No confirmed medicines"
        // The distinction this screen exists to hold: a medicine an AI read off
        // a prescription is a reading of a document. A schedule is a commitment
        // about what somebody takes and when. The first never becomes the
        // second without a person confirming it.
        message="A medicine written on a prescription is not the same as a schedule to follow. Confirming one, and recording each dose, is being built."
        testID="me-health-medicines-notice"
      />

      <SectionHeader title="Notes and symptoms" testID="me-health-notes-header" />
      <Callout
        tone="neutral"
        title="Not available yet"
        message="Writing down how you are feeling, in your own words, so it is there at your next visit — this is being built."
        testID="me-health-notes-notice"
      />

      <SectionHeader
        title="My to-do"
        actionLabel="Add"
        onAction={() => router.push('/follow-up/new')}
        testID="me-health-tasks-header"
      />

      {followUps.length === 0 ? (
        <Card tone="quiet" style={styles.last} testID="me-health-tasks-empty">
          <Text variant="callout" tone="secondary">
            Nothing to do right now.
          </Text>
        </Card>
      ) : (
        followUps.map((followUp) => (
          <FollowUpCard
            key={followUp.id}
            followUp={followUp}
            parentName={record.fullName}
            onPress={() => router.push(`/follow-up/${followUp.id}`)}
            testID={`me-health-task-${followUp.id}`}
          />
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  last: { marginBottom: spacing.xl },
});
