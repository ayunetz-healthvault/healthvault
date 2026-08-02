import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Avatar,
  Badge,
  Button,
  Card,
  DocumentCard,
  EmptyState,
  FollowUpCard,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import {
  selectDocumentTimeline,
  selectFollowUpsForParent,
  selectParent,
  useVaultStore,
} from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import { RELATIONSHIP_LABELS } from '@/types/labels';
import { calculateAge, formatDate } from '@/utils/date';
import { pluralise } from '@/utils/format';

/**
 * A parent's profile: who they are, then their document timeline.
 *
 * The timeline is the point of this screen — documents newest first, so the
 * most recent report is the first thing anyone sees.
 */
export default function ParentProfileScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const vault = useVaultStore((state) => ({
    parents: state.parents,
    documents: state.documents,
    summaries: state.summaries,
    followUps: state.followUps,
  }));

  const parent = id ? selectParent(vault, id) : undefined;

  if (!parent) {
    return (
      <Screen testID="parent-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Profile not found"
          message="This profile may have been deleted from another device."
          actionLabel="Back to home"
          onAction={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  const documents = selectDocumentTimeline(vault, parent.id);
  const followUps = selectFollowUpsForParent(vault, parent.id).filter(
    (item) => item.status === 'scheduled',
  );
  const age = calculateAge(parent.dateOfBirth);

  return (
    <Screen
      testID="parent-profile"
      footer={
        <Button
          label="Add a document"
          icon="camera-outline"
          onPress={() => router.push(`/capture?parentId=${parent.id}`)}
          testID="parent-add-document"
        />
      }
    >
      <View style={styles.header}>
        <Avatar name={parent.fullName} color={parent.avatarColor} size={80} />
        <Text variant="title" align="center" style={styles.name}>
          {parent.fullName}
        </Text>
        <Text variant="callout" tone="secondary" align="center">
          {[
            RELATIONSHIP_LABELS[parent.relationship],
            age === null ? null : `${age} years`,
            parent.city || null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>

        <Button
          label="Edit profile"
          variant="secondary"
          size="medium"
          icon="create-outline"
          fullWidth={false}
          onPress={() => router.push(`/parent/${parent.id}/edit`)}
          style={styles.editButton}
          testID="parent-edit-button"
        />
      </View>

      <Card style={styles.detailsCard}>
        <DetailRow
          icon="water-outline"
          label="Blood group"
          value={parent.bloodGroup === 'unknown' ? 'Not recorded' : parent.bloodGroup}
        />
        <DetailRow icon="call-outline" label="Phone" value={parent.phone || 'Not recorded'} />
        <DetailRow
          icon="medkit-outline"
          label="Usual doctor"
          value={parent.primaryDoctor || 'Not recorded'}
        />
        <DetailRow
          icon="calendar-outline"
          label="Date of birth"
          value={parent.dateOfBirth ? formatDate(parent.dateOfBirth) : 'Not recorded'}
          last
        />
      </Card>

      {parent.conditions.length > 0 || parent.allergies.length > 0 ? (
        <Card style={styles.detailsCard}>
          {parent.conditions.length > 0 ? (
            <View style={styles.tagGroup}>
              <Text variant="label" tone="secondary" style={styles.tagLabel}>
                Ongoing conditions
              </Text>
              <View style={styles.tags}>
                {parent.conditions.map((condition) => (
                  <Badge key={condition} label={condition} tone="brand" />
                ))}
              </View>
            </View>
          ) : null}

          {parent.allergies.length > 0 ? (
            <View style={styles.tagGroup}>
              <Text variant="label" tone="secondary" style={styles.tagLabel}>
                Allergies
              </Text>
              <View style={styles.tags}>
                {parent.allergies.map((allergy) => (
                  <Badge key={allergy} label={allergy} tone="danger" icon="alert-circle" />
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      ) : null}

      {parent.notes ? (
        <Card style={styles.detailsCard}>
          <Text variant="label" tone="secondary" style={styles.tagLabel}>
            Notes
          </Text>
          <Text variant="callout">{parent.notes}</Text>
        </Card>
      ) : null}

      <SectionHeader
        title="Upcoming"
        actionLabel="Add"
        onAction={() => router.push(`/follow-up/new?parentId=${parent.id}`)}
        testID="parent-followups-header"
      />

      {followUps.length === 0 ? (
        <Card>
          <Text variant="callout" tone="secondary">
            Nothing scheduled for {parent.fullName.split(' ')[0]} right now.
          </Text>
        </Card>
      ) : (
        followUps.map((followUp) => (
          <FollowUpCard
            key={followUp.id}
            followUp={followUp}
            onPress={() => router.push(`/follow-up/${followUp.id}`)}
            testID={`parent-followup-${followUp.id}`}
          />
        ))
      )}

      <SectionHeader
        title="Document timeline"
        subtitle={
          documents.length === 0
            ? undefined
            : `${pluralise(documents.length, 'document')}, newest first`
        }
        testID="parent-timeline-header"
      />

      {documents.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title="No documents yet"
          message="Scan a report, take a photo, or pick a PDF the lab emailed. Everything you add appears here in date order."
          actionLabel="Add a document"
          onAction={() => router.push(`/capture?parentId=${parent.id}`)}
          testID="parent-timeline-empty"
        />
      ) : (
        documents.map((document) => (
          <DocumentCard
            key={document.id}
            document={document}
            onPress={() =>
              router.push(
                document.status === 'ready'
                  ? `/document/${document.id}`
                  : `/document/${document.id}/processing`,
              )
            }
            testID={`parent-document-${document.id}`}
          />
        ))
      )}
    </Screen>
  );
}

interface DetailRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  last?: boolean;
}

function DetailRow({ icon, label, value, last = false }: DetailRowProps): React.JSX.Element {
  return (
    <View style={[styles.detailRow, last ? styles.detailRowLast : null]}>
      <Ionicons name={icon} size={20} color={colors.textMuted} />
      <Text variant="callout" tone="secondary" style={styles.detailLabel}>
        {label}
      </Text>
      <Text variant="callout" style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  detailLabel: { width: 110 },
  detailRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  detailRowLast: { borderBottomWidth: 0 },
  detailValue: { flex: 1, textAlign: 'right' },
  detailsCard: { marginBottom: spacing.md },
  editButton: { marginTop: spacing.lg },
  header: { alignItems: 'center', marginBottom: spacing.xl, paddingTop: spacing.lg },
  name: { marginBottom: spacing.xs, marginTop: spacing.lg },
  tagGroup: { marginBottom: spacing.md },
  tagLabel: { marginBottom: spacing.sm },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
