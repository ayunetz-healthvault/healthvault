import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components';
import { isBackendEnabled } from '@/config/env';
import { reviewService, type DocumentPageUrl } from '@/services/review/reviewService';
import { useSessionStore } from '@/state/sessionStore';
import {
  selectDocument,
  selectSummaryForDocument,
  useVaultSnapshot,
  useVaultStore,
} from '@/state/vaultStore';
import { spacing } from '@/theme';
import type { SummaryCorrection } from '@/types/domain';
import { formatDateTime, nowIso } from '@/utils/date';
import { createId } from '@/utils/id';

/**
 * Checking a summary against the original.
 *
 * ## The three things this screen keeps apart
 *
 * 1. **What the clinician wrote** — the page images, unchanged, at the top.
 *    Nothing here can alter them.
 * 2. **What the app read** — each field as the pipeline produced it, shown
 *    beside the page it came from.
 * 3. **What a person says instead** — a correction, appended, naming who and
 *    which version they were looking at.
 *
 * The model's text is never overwritten. Somebody saying "that says 124, not
 * 142" is a second fact about the document, and losing the first means nobody
 * can ever tell whether the model was wrong or the corrector was.
 *
 * ## What checking is not
 *
 * A person confirming the app read a page correctly is **not** a clinician
 * validating the content. Nothing on this screen says verified, approved or
 * confirmed correct, and the button says what it does: "I have checked this
 * against the original".
 */
export default function DocumentReviewScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const vault = useVaultSnapshot();
  const userId = useSessionStore((state) => state.user?.id ?? 'usr_local');
  const addCorrection = useVaultStore((state) => state.addCorrection);
  const markSummaryReviewed = useVaultStore((state) => state.markSummaryReviewed);

  const document = id ? selectDocument(vault, id) : undefined;
  const summary = id ? selectSummaryForDocument(vault, id) : undefined;

  const [pages, setPages] = useState<DocumentPageUrl[]>([]);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ field: string; label: string; previous: string } | null>(
    null,
  );
  const [correctedValue, setCorrectedValue] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmReview, setConfirmReview] = useState(false);

  const patientId = document?.parentId;
  const documentId = document?.id;

  useEffect(() => {
    if (patientId === undefined || documentId === undefined || !isBackendEnabled()) return;

    let cancelled = false;

    void reviewService.pages(patientId, documentId).then(
      (fetched) => {
        if (!cancelled) {
          setPages(fetched);
          setPagesError(null);
        }
      },
      () => {
        /**
         * The originals could not be fetched. Said plainly rather than shown as
         * an empty strip: a review screen with no original is not a review
         * screen, and nobody may tick "checked" against nothing.
         */
        if (cancelled) return;
        setPages([]);
        setPagesError(
          'The original pages could not be loaded, so there is nothing to check against.',
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [patientId, documentId]);

  if (!document || !summary) {
    return (
      <Screen testID="review-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Nothing to check"
          message="This document has no summary yet, so there is nothing to compare with the original."
          actionLabel="Back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const version = summary.version ?? 1;
  const corrections = summary.corrections ?? [];
  /** Local pages, when this device is the one that captured them. */
  const localPages = document.pages;
  const canCheck = pages.length > 0 || localPages.length > 0;

  const saveCorrection = (): void => {
    if (editing === null) return;

    const correction: SummaryCorrection = {
      id: createId('sum'),
      field: editing.field,
      previousValue: editing.previous,
      correctedValue: correctedValue.trim(),
      correctedBy: userId,
      correctedAt: nowIso(),
      summaryVersion: version,
    };

    addCorrection(document.id, correction);
    setEditing(null);
    setCorrectedValue('');

    if (!isBackendEnabled()) {
      setNotice('Saved on this phone. There is no server in this build to send it to.');
      return;
    }

    void reviewService
      .correct({
        patientId: document.parentId,
        documentId: document.id,
        field: correction.field,
        previousValue: correction.previousValue,
        correctedValue: correction.correctedValue,
        summaryVersion: version,
      })
      .then(
        (result) => {
          setNotice(
            result.outcome === 'summary_changed'
              ? 'This document has been read again since you opened it. Your note is saved here, but check the new version before relying on it.'
              : null,
          );
        },
        () => setNotice('Saved on this phone. It could not be sent yet and will be tried again.'),
      );
  };

  const handleChecked = (): void => {
    setConfirmReview(false);
    markSummaryReviewed(document.id, userId, version);

    if (!isBackendEnabled()) return;

    void reviewService.markReviewed(document.parentId, document.id, version).then(
      (result) => {
        if (result.outcome === 'summary_changed') {
          setNotice('This summary changed while you were reading it. Please check it again.');
        }
      },
      () => setNotice('Recorded on this phone. It could not be sent yet.'),
    );
  };

  const correctionsFor = (field: string): SummaryCorrection[] =>
    corrections.filter((correction) => correction.field === field);

  const field = (
    key: string,
    label: string,
    value: string,
    testID: string,
  ): React.JSX.Element => (
    <Card key={key} tone="quiet" style={styles.field} testID={testID}>
      <Text variant="caption" tone="secondary">
        {label}
      </Text>
      <Text variant="callout">{value}</Text>

      {correctionsFor(key).map((correction) => (
        <View key={correction.id} style={styles.correction}>
          <Badge label="Corrected" tone="warning" />
          <Text variant="callout">{correction.correctedValue}</Text>
          <Text variant="caption" tone="secondary">
            {/*
              The model's version stays above, visibly. Whoever reads this next
              can see both and decide, which is the whole point of appending.
            */}
            The app read “{correction.previousValue}”. Corrected{' '}
            {formatDateTime(correction.correctedAt)}.
          </Text>
        </View>
      ))}

      <Button
        label="This is not what the document says"
        variant="secondary"
        size="medium"
        fullWidth={false}
        onPress={() => {
          setEditing({ field: key, label, previous: value });
          setCorrectedValue(value);
        }}
        testID={`${testID}-correct`}
      />
    </Card>
  );

  return (
    <Screen
      testID="document-review"
      footer={
        <>
          <Button
            label="I have checked this against the original"
            icon="checkmark-circle-outline"
            disabled={!canCheck}
            onPress={() => setConfirmReview(true)}
            testID="review-confirm"
          />
          <Button label="Done" variant="ghost" onPress={() => router.back()} />
        </>
      }
    >
      <SectionHeader
        title="Check this against the original"
        subtitle={document.title}
        testID="review-header"
      />

      {summary.reviewedAt ? (
        <Callout
          tone="info"
          message={
            summary.reviewedVersion === version
              ? `Checked ${formatDateTime(summary.reviewedAt)}. This says somebody compared it with the original — not that a clinician agreed with it.`
              : 'This document was read again after it was last checked, so it needs checking again.'
          }
          testID="review-status"
        />
      ) : null}

      {notice === null ? null : <Callout tone="warning" message={notice} testID="review-notice" />}

      <SectionHeader title="The original" testID="review-original-header" />

      {pagesError !== null ? (
        <Callout tone="warning" message={pagesError} testID="review-pages-error" />
      ) : null}

      {!canCheck ? (
        <Card tone="quiet" testID="review-no-pages">
          <Text variant="callout" tone="secondary">
            The original pages are not on this phone and could not be fetched. Nothing can be
            checked until they are.
          </Text>
        </Card>
      ) : (
        <View style={styles.pages} testID="review-pages">
          {(pages.length > 0
            ? pages.map((page) => ({ key: `remote-${page.page}`, uri: page.url }))
            : localPages.map((page) => ({ key: page.id, uri: page.uri }))
          ).map((page) => (
            <Image
              key={page.key}
              source={{ uri: page.uri }}
              style={styles.page}
              resizeMode="contain"
              accessibilityLabel="A page of the original document"
            />
          ))}
        </View>
      )}

      <SectionHeader
        title="What the app read"
        subtitle="Correct anything that does not match the page above"
        testID="review-fields-header"
      />

      {field('overview', 'Overview', summary.overview, 'review-overview')}
      {field(
        'plainLanguageSummary',
        'In plain language',
        summary.plainLanguageSummary,
        'review-plain',
      )}

      {summary.findings.map((finding, index) =>
        field(
          `findings.${index}.value`,
          finding.label,
          [finding.value, finding.unit].filter(Boolean).join(' '),
          `review-finding-${index}`,
        ),
      )}

      {summary.medicines.map((medicine, index) =>
        field(
          `medicines.${index}.dosage`,
          medicine.name,
          [medicine.dosage, medicine.frequency].filter(Boolean).join(' · '),
          `review-medicine-${index}`,
        ),
      )}

      <ConfirmDialog
        visible={editing !== null}
        title={editing?.label ?? ''}
        message="Type what the document actually says. The app's version is kept alongside yours — nothing is overwritten."
        confirmLabel="Save this correction"
        confirmDisabled={correctedValue.trim().length === 0}
        onConfirm={saveCorrection}
        onCancel={() => {
          setEditing(null);
          setCorrectedValue('');
        }}
        testID="review-correction-dialog"
      >
        <TextField
          label="What it actually says"
          value={correctedValue}
          onChangeText={setCorrectedValue}
          multiline
          testID="review-correction-input"
        />
      </ConfirmDialog>

      <ConfirmDialog
        visible={confirmReview}
        title="Checked against the original?"
        message="This records that you compared this summary with the pages above. It does not say a doctor has agreed with it, and it is not medical advice."
        confirmLabel="Yes, I checked it"
        onConfirm={handleChecked}
        onCancel={() => setConfirmReview(false)}
        testID="review-confirm-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  correction: { gap: spacing.xxs, marginTop: spacing.xs },
  field: { gap: spacing.xs, marginBottom: spacing.sm },
  page: { borderRadius: 8, height: 220, width: '100%' },
  pages: { gap: spacing.sm },
});
