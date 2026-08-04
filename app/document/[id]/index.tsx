import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  FindingRow,
  MedicineRow,
  Screen,
  SectionHeader,
  SourceBadge,
  Text,
} from '@/components';
import { AI_SUMMARY_DISCLAIMER } from '@/services/ai/summaryService';
import { accountService } from '@/services/account/accountService';
import {
  selectDocument,
  selectParent,
  selectSummaryForDocument,
  useVaultSnapshot,
  useVaultStore,
} from '@/state/vaultStore';
import { colors, radius, spacing } from '@/theme';
import {
  DOCTOR_CATEGORY_LABELS,
  DOCUMENT_CATEGORY_LABELS,
  PROCESSING_STATUS_LABELS,
} from '@/types/labels';
import { formatDate, formatDateTime } from '@/utils/date';
import { pluralise } from '@/utils/format';

/**
 * The document summary.
 *
 * Section order is deliberate — overview, then the plain-language read, then
 * the detail. Someone glancing at this between meetings gets the answer in the
 * first two cards; the findings and medicines are there when they sit down with
 * it properly. The disclaimer sits above the summary, not buried at the bottom.
 */
export default function DocumentSummaryScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [deleteVisible, setDeleteVisible] = useState(false);

  const vault = useVaultSnapshot();
  const removeDocument = useVaultStore((state) => state.removeDocument);

  const document = id ? selectDocument(vault, id) : undefined;
  const summary = id ? selectSummaryForDocument(vault, id) : undefined;
  const parent = document ? selectParent(vault, document.parentId) : undefined;

  if (!document) {
    return (
      <Screen testID="document-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Document not found"
          message="It may have been deleted."
          actionLabel="Back to home"
          onAction={() => router.replace('/(tabs)')}
        />
      </Screen>
    );
  }

  const handleDelete = async (): Promise<void> => {
    setDeleteVisible(false);
    await accountService.deleteDocument(document.id);
    removeDocument(document.id);
    router.replace(`/parent/${document.parentId}`);
  };

  const lowConfidence = summary !== undefined && summary.confidence < 0.7;
  const uncertainties = summary?.uncertainties ?? [];
  const explicitFollowUps = summary?.explicitFollowUps ?? [];
  const redactedCount = Object.values(summary?.privacy?.redactedEntityCounts ?? {}).reduce(
    (total, count) => total + count,
    0,
  );

  return (
    <Screen
      testID="document-summary"
      footer={
        <>
          <Button
            label="Add a follow-up from this"
            icon="calendar-outline"
            onPress={() =>
              router.push(
                `/follow-up/new?parentId=${document.parentId}&documentId=${document.id}${
                  summary ? `&doctorCategory=${summary.recommendedDoctorCategory}` : ''
                }`,
              )
            }
            testID="document-add-followup"
          />
          <Button
            label="Delete this document"
            variant="ghost"
            onPress={() => setDeleteVisible(true)}
            testID="document-delete"
          />
        </>
      }
    >
      <View style={styles.header}>
        <Badge label={DOCUMENT_CATEGORY_LABELS[document.category]} tone="brand" />
        <Text variant="title" style={styles.title}>
          {document.title}
        </Text>
        <Text variant="callout" tone="secondary">
          {parent ? `${parent.fullName} · ` : ''}
          {formatDate(document.documentDate)} · {pluralise(document.pages.length, 'page')}
        </Text>
      </View>

      {!summary ? (
        <>
          <Callout
            tone="info"
            title={PROCESSING_STATUS_LABELS[document.status]}
            message="This document has not been summarised yet."
          />
          <Button
            label="Check processing status"
            variant="secondary"
            onPress={() => router.push(`/document/${document.id}/processing`)}
            style={styles.statusButton}
            testID="document-check-status"
          />
        </>
      ) : (
        <>
          <Callout
            tone="warning"
            title="Automatically generated — not medical advice"
            message={AI_SUMMARY_DISCLAIMER}
            testID="document-disclaimer"
          />

          {lowConfidence ? (
            <Callout
              tone="info"
              title="Lower confidence"
              message="Parts of this document were hard to read, so this summary is less reliable than usual. Check it against the original carefully."
              testID="document-low-confidence"
            />
          ) : null}

          {/*
            What the pipeline could not do, stated before anything it claims to
            have read. A missing page changes how much weight the rest deserves,
            so burying it under the findings would be the wrong order.
          */}
          {uncertainties.length > 0 ? (
            <Callout
              tone="warning"
              title={
                uncertainties.length === 1
                  ? 'One part could not be read'
                  : `${uncertainties.length} parts could not be read`
              }
              message={uncertainties
                .map((item) =>
                  item.sourcePage === null
                    ? item.message
                    : `Page ${item.sourcePage}: ${item.message}`,
                )
                .join('\n\n')}
              testID="document-uncertainties"
            />
          ) : null}

          {/* 1. What this document is */}
          <SectionHeader title="What this document is" />
          <Card>
            <Text variant="callout">{summary.overview}</Text>
          </Card>

          {/* 2. In plain language */}
          <SectionHeader title="In plain language" />
          <Card tone="accent">
            <Text variant="body">{summary.plainLanguageSummary}</Text>
          </Card>

          {/* 3. Findings */}
          {summary.findings.length > 0 ? (
            <>
              <SectionHeader
                title="What was measured"
                subtitle={`${pluralise(summary.findings.length, 'result')} found in the document`}
              />
              <Card padded={false} style={styles.listCard}>
                <View style={styles.listInner}>
                  {summary.findings.map((finding) => (
                    <FindingRow
                      key={finding.id}
                      finding={finding}
                      testID={`finding-${finding.id}`}
                    />
                  ))}
                </View>
              </Card>
            </>
          ) : null}

          {/* 4. Medicines */}
          {summary.medicines.length > 0 ? (
            <>
              <SectionHeader
                title="Medicines mentioned"
                subtitle="As written in this document — not a prescription from Ayunetz"
              />
              <Card padded={false} style={styles.listCard}>
                <View style={styles.listInner}>
                  {summary.medicines.map((medicine) => (
                    <MedicineRow
                      key={medicine.id}
                      medicine={medicine}
                      testID={`medicine-${medicine.id}`}
                    />
                  ))}
                </View>
              </Card>
            </>
          ) : null}

          {/* 5. Instructions */}
          {summary.instructions.length > 0 ? (
            <>
              <SectionHeader
                title="Instructions in the document"
                subtitle="Transcribed from the document itself"
              />
              <Card>
                {summary.instructions.map((instruction, index) => (
                  <View
                    key={instruction}
                    style={[
                      styles.bulletRow,
                      index === summary.instructions.length - 1 ? styles.bulletRowLast : null,
                    ]}
                  >
                    <View style={styles.bulletDot}>
                      <Text variant="caption" tone="inverse" style={styles.bulletNumber}>
                        {index + 1}
                      </Text>
                    </View>
                    <Text variant="callout" style={styles.bulletText}>
                      {instruction}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/*
            5b. Follow-ups the document itself asks for.
            Kept separate from the generated questions below, and from the
            follow-ups the user creates. Three different things with three
            different authorities: the doctor wrote this, the app suggested
            that, the user committed to the other.
          */}
          {explicitFollowUps.length > 0 ? (
            <>
              <SectionHeader
                title="What the document asks for next"
                subtitle="Written in the document — not created by this app"
              />
              <Card>
                {explicitFollowUps.map((followUp, index) => (
                  <View
                    key={`${followUp.title}-${followUp.source.page}`}
                    style={[
                      styles.bulletRow,
                      index === explicitFollowUps.length - 1 ? styles.bulletRowLast : null,
                    ]}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={22}
                      color={colors.primary}
                      style={styles.questionIcon}
                    />
                    <View style={styles.bulletText}>
                      <Text variant="callout">{followUp.title}</Text>
                      <Text variant="caption" tone="secondary">
                        {followUp.date
                          ? formatDate(followUp.date)
                          : 'No date given in the document'}
                      </Text>
                      <SourceBadge
                        sources={[followUp.source]}
                        testID={`explicit-followup-${index}-source`}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {/* 6. Which doctor */}
          <SectionHeader title="Which doctor to see" />
          <Card>
            <View style={styles.doctorRow}>
              <View style={styles.doctorIcon}>
                <Ionicons name="medkit" size={26} color={colors.primary} />
              </View>
              <View style={styles.doctorBody}>
                <Text variant="subheading">
                  {DOCTOR_CATEGORY_LABELS[summary.recommendedDoctorCategory]}
                </Text>
                <Text variant="caption" tone="secondary" style={styles.doctorNote}>
                  Suggested from the contents of this document. Your parent’s usual doctor may refer
                  them somewhere else.
                </Text>
              </View>
            </View>
            {parent?.primaryDoctor ? (
              <View style={styles.usualDoctor}>
                <Text variant="caption" tone="muted">
                  Usual doctor: {parent.primaryDoctor}
                </Text>
              </View>
            ) : null}
          </Card>

          {/* 7. Questions to ask */}
          {summary.questionsForDoctor.length > 0 ? (
            <>
              <SectionHeader
                title="Questions to ask"
                // Explicitly attributed. A generated question sitting under a
                // doctor's instructions would read as something the doctor said.
                subtitle="Written by Ayunetz from this document — nobody has asked these yet"
              />
              <Card>
                {summary.questionsForDoctor.map((question, index) => (
                  <View
                    key={question}
                    style={[
                      styles.bulletRow,
                      index === summary.questionsForDoctor.length - 1 ? styles.bulletRowLast : null,
                    ]}
                  >
                    <Ionicons
                      name="help-circle-outline"
                      size={22}
                      color={colors.primary}
                      style={styles.questionIcon}
                    />
                    <Text variant="callout" style={styles.bulletText}>
                      {question}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <View style={styles.provenance}>
            <Text variant="caption" tone="muted">
              Summarised {formatDateTime(summary.generatedAt)} · {summary.generatedBy} · confidence{' '}
              {Math.round(summary.confidence * 100)}%
            </Text>
            {/*
              Says what was removed before anything left this phone, in counts
              only. Someone handing their parent's records to an app is owed a
              plain statement of what it did with them.
            */}
            {summary.privacy ? (
              <Text variant="caption" tone="muted" style={styles.privacyNote}>
                {redactedCount === 0
                  ? 'No personal identifiers were found to remove before summarising.'
                  : `${pluralise(redactedCount, 'personal detail')} removed before this document was summarised (${summary.privacy.pipelineVersion}).`}
              </Text>
            ) : null}
          </View>
        </>
      )}

      <ConfirmDialog
        visible={deleteVisible}
        title="Delete this document?"
        message={`“${document.title}” and its summary will be permanently deleted, including the ${pluralise(document.pages.length, 'stored page')}. This cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteVisible(false)}
        testID="document-delete-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bulletDot: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  bulletNumber: { fontWeight: '700' },
  bulletRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingBottom: spacing.lg,
    paddingTop: spacing.md,
  },
  bulletRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  bulletText: { flex: 1 },
  doctorBody: { flex: 1 },
  doctorIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  doctorNote: { marginTop: spacing.xs },
  doctorRow: { flexDirection: 'row', gap: spacing.lg },
  header: { gap: spacing.sm, marginBottom: spacing.lg, paddingTop: spacing.lg },
  listCard: { overflow: 'hidden' },
  listInner: { paddingHorizontal: spacing.lg },
  privacyNote: { marginTop: spacing.xs },
  provenance: { gap: spacing.xxs, marginTop: spacing.xxl, paddingHorizontal: spacing.xs },
  questionIcon: { marginTop: 1 },
  statusButton: { marginTop: spacing.lg },
  title: { marginTop: spacing.xs },
  usualDoctor: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: spacing.lg,
    paddingTop: spacing.md,
  },
});
