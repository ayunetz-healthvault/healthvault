import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import {
  attributeObservation,
  attributeQuestion,
  buildVisitPreparation,
  isStale,
} from '@/services/observations/visitPreparation';
import {
  selectFollowUp,
  selectLiveSchedules,
  selectObservations,
  selectParent,
  selectVisitQuestions,
  useVaultSnapshot,
} from '@/state/vaultStore';
import { spacing } from '@/theme';
import { IMPACT_LABELS } from '@/types/observations';
import { formatDate, formatDateTime } from '@/utils/date';

/**
 * What to take to an appointment.
 *
 * ## What this is
 *
 * The family's own notes, gathered into one screen so nobody stands in a
 * corridor scrolling through six weeks of the app. Observations in the person's
 * words, the questions they want to ask, the medicines actually being taken,
 * which documents to bring, and what the summariser could not read.
 *
 * ## What it is not
 *
 * It is not sent anywhere. There is no "share with your doctor" button, no
 * export to a clinical format, and no summary of what the notes *mean* —
 * preparing for a visit is getting your own notes in order, and every attempt
 * to make it more than that turns an app for families into one that talks to
 * doctors on their behalf.
 *
 * It also says when the record was last synced. A list assembled from a record
 * that last updated a week ago may be missing whatever a sibling added since,
 * and a printed-looking page that quietly omits it is worse than no page.
 */
export default function VisitPreparationScreen(): React.JSX.Element {
  const router = useRouter();
  const { followUpId } = useLocalSearchParams<{ followUpId: string }>();

  const vault = useVaultSnapshot();
  const followUp = followUpId ? selectFollowUp(vault, followUpId) : undefined;
  const parent = followUp ? selectParent(vault, followUp.parentId) : undefined;

  if (!followUp || !parent) {
    return (
      <Screen testID="visit-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Appointment not found"
          message="It may have been deleted."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const preparation = buildVisitPreparation({
    patientId: parent.id,
    followUpId: followUp.id,
    observations: selectObservations(vault, parent.id),
    questions: selectVisitQuestions(vault, parent.id),
    documents: vault.documents,
    summaries: vault.summaries,
    /**
     * Confirmed schedules only. A medicine a model read off a prescription is
     * not something this person is taking, and handing a doctor a list that
     * mixed the two would be the most consequential place to blur them.
     */
    confirmedMedicineNames: selectLiveSchedules(vault, parent.id).map((schedule) => schedule.name),
    /**
     * When the record was last confirmed against the server — not when this
     * device last saved something. A phone that has been offline for a week has
     * a complete-looking list and no idea what it is missing.
     */
    lastSyncedAt: vault.lastPulledAt,
  });

  const stale = isStale(preparation);

  return (
    <Screen
      testID="visit-preparation"
      footer={
        <Button
          label="Add a note"
          icon="create-outline"
          onPress={() => router.push(`/observation/new?patientId=${parent.id}`)}
          testID="visit-add-note"
        />
      }
    >
      <SectionHeader
        title="Taking to this appointment"
        subtitle={`${followUp.title} · ${formatDate(followUp.dueDate)}`}
        testID="visit-header"
      />

      {stale ? (
        <Callout
          tone="warning"
          message={
            preparation.lastSyncedAt === null
              ? 'These are the notes on this phone. They have not been checked against the shared record, so somebody else may have added something you cannot see here.'
              : `Last checked against the shared record ${formatDateTime(preparation.lastSyncedAt)}. Anything added elsewhere since then is not on this list.`
          }
          testID="visit-stale"
        />
      ) : null}

      <SectionHeader title="What you have noticed" testID="visit-observations-header" />
      {preparation.observations.length === 0 ? (
        <Card tone="quiet" testID="visit-observations-empty">
          <Text variant="callout" tone="secondary">
            No notes in the last six weeks. Nothing written down is not the same as nothing to say —
            add anything you have noticed before you go.
          </Text>
        </Card>
      ) : (
        preparation.observations.map((observation) => (
          <Card key={observation.id} tone="quiet" style={styles.item} testID={`visit-observation-${observation.id}`}>
            <Text variant="callout">{observation.text}</Text>
            <View style={styles.meta}>
              <Badge label={IMPACT_LABELS[observation.impact]} tone="neutral" />
              {/*
                A helper's note is what the helper observed, which is a
                different claim from what the person said about themselves.
              */}
              <Text variant="caption" tone="secondary">
                {formatDate(observation.occurredAt.slice(0, 10))} · {attributeObservation(observation)}
              </Text>
            </View>
          </Card>
        ))
      )}

      <SectionHeader title="What to ask" testID="visit-questions-header" />
      {preparation.questions.length === 0 ? (
        <Card tone="quiet" testID="visit-questions-empty">
          <Text variant="callout" tone="secondary">
            No questions yet. A summary can suggest some, and they only appear here once you have
            kept one.
          </Text>
        </Card>
      ) : (
        preparation.questions.map((question) => (
          <Card key={question.id} tone="quiet" style={styles.item} testID={`visit-question-${question.id}`}>
            <Text variant="callout">{question.text}</Text>
            <Text variant="caption" tone="secondary">
              {attributeQuestion(question)}
            </Text>
          </Card>
        ))
      )}

      <SectionHeader title="Medicines being taken" testID="visit-medicines-header" />
      <Card tone="quiet" testID="visit-medicines">
        {preparation.medicines.length === 0 ? (
          <Text variant="callout" tone="secondary">
            No confirmed medicines. Anything on a prescription is in the documents below — this list
            is only what somebody has confirmed is actually being taken.
          </Text>
        ) : (
          preparation.medicines.map((name) => (
            <Text key={name} variant="callout">
              {name}
            </Text>
          ))
        )}
      </Card>

      <SectionHeader title="Documents to bring" testID="visit-documents-header" />
      {preparation.documents.length === 0 ? (
        <Card tone="quiet" testID="visit-documents-empty">
          <Text variant="callout" tone="secondary">
            No documents on this record yet.
          </Text>
        </Card>
      ) : (
        preparation.documents.map((document) => (
          <Card
            key={document.documentId}
            tone="quiet"
            style={styles.item}
            onPress={() => router.push(`/document/${document.documentId}`)}
            testID={`visit-document-${document.documentId}`}
          >
            <Text variant="bodyStrong">{document.title}</Text>
            <Text variant="caption" tone="secondary">
              {/*
                An unchecked summary is not a reason to leave the document
                behind — it is a reason to bring the original.
              */}
              {document.reviewed
                ? 'Somebody has checked this summary against the original.'
                : 'Nobody has checked this summary yet. Bring the original.'}
            </Text>
          </Card>
        ))
      )}

      {preparation.uncertainties.length === 0 ? null : (
        <>
          <SectionHeader
            title="What could not be read"
            subtitle="Worth asking about — the app was not sure of these"
            testID="visit-uncertainties-header"
          />
          <Card tone="quiet" testID="visit-uncertainties">
            {preparation.uncertainties.map((message) => (
              <Text key={message} variant="callout" style={styles.item}>
                {message}
              </Text>
            ))}
          </Card>
        </>
      )}

      <Callout
        tone="neutral"
        message="This is your own list. Nothing here is sent to the clinic, and none of it is medical advice."
        testID="visit-disclaimer"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.xxs, marginBottom: spacing.sm },
  meta: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
