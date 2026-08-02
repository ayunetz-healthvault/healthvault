import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button, Callout, Card, EmptyState, ProgressBar, Screen, Text } from '@/components';
import {
  PROCESSING_STAGES,
  PROCESSING_STAGE_LABELS,
  type ProcessingStage,
  summaryService,
} from '@/services/ai/summaryService';
import { uploadService } from '@/services/upload/uploadService';
import { useSessionStore } from '@/state/sessionStore';
import { useVaultStore } from '@/state/vaultStore';
import { colors, radius, spacing } from '@/theme';
import { pluralise } from '@/utils/format';

type Phase = 'uploading' | 'processing' | 'ready' | 'failed';

/**
 * Upload + processing status.
 *
 * Shows the two halves separately — bytes leaving the phone, then the pipeline
 * reading them — because they fail for different reasons and a caregiver on a
 * hotel wifi needs to know which one stalled.
 */
export default function ProcessingScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const userId = useSessionStore((state) => state.user?.id ?? 'usr_local');
  const documents = useVaultStore((state) => state.documents);
  const updateDocumentStatus = useVaultStore((state) => state.updateDocumentStatus);
  const addSummary = useVaultStore((state) => state.addSummary);

  const document = documents.find((item) => item.id === id);

  /**
   * A document reached from the timeline has already been through the pipeline.
   * That is derived from its stored status at first render rather than pushed
   * in from an effect — an effect here would render the "uploading" state for a
   * frame and then correct itself.
   */
  const alreadyProcessed = document?.status === 'ready';

  const [phase, setPhase] = useState<Phase>(alreadyProcessed ? 'ready' : 'uploading');
  const [uploadPercent, setUploadPercent] = useState(alreadyProcessed ? 100 : 0);
  const [stage, setStage] = useState<ProcessingStage>(alreadyProcessed ? 'done' : 'queued');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    if (!document) return;

    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setPhase('uploading');
    setUploadPercent(0);

    try {
      updateDocumentStatus(document.id, 'uploading', { uploadProgress: 0 });

      const result = await uploadService.uploadDocument({
        userId,
        parentId: document.parentId,
        documentId: document.id,
        pages: document.pages,
        onProgress: (progress) => setUploadPercent(progress.percent),
        signal: controller.signal,
      });

      await uploadService.completeUpload(document.id, result.objectKeys);
      updateDocumentStatus(document.id, 'uploaded', { uploadProgress: 100 });

      setPhase('processing');
      const summary = await summaryService.processDocument(
        document,
        (state) => setStage(state.stage),
        controller.signal,
      );

      addSummary(summary);
      updateDocumentStatus(document.id, 'ready', { summaryId: summary.id, failureReason: null });
      setPhase('ready');
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : 'The document could not be processed.';
      setError(message);
      setPhase('failed');
      updateDocumentStatus(document.id, 'failed', { failureReason: message });
    }
  }, [document, userId, updateDocumentStatus, addSummary]);

  useEffect(() => {
    // Fires once per mount. A finished document is left alone rather than
    // re-uploaded; `startedRef` guards against the store updating mid-run and
    // re-triggering the pipeline.
    if (!document || alreadyProcessed || startedRef.current) return;
    startedRef.current = true;

    void run();
    return () => abortRef.current?.abort();
  }, [document, alreadyProcessed, run]);

  if (!document) {
    return (
      <Screen testID="processing-missing">
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

  return (
    <Screen
      testID="processing"
      footer={
        phase === 'ready' ? (
          <>
            <Button
              label="See the summary"
              icon="sparkles"
              onPress={() => router.replace(`/document/${document.id}`)}
              testID="processing-view-summary"
            />
            <Button
              label="Back to profile"
              variant="ghost"
              onPress={() => router.replace(`/parent/${document.parentId}`)}
            />
          </>
        ) : phase === 'failed' ? (
          <>
            <Button
              label="Try again"
              icon="refresh"
              onPress={() => void run()}
              testID="processing-retry"
            />
            <Button
              label="Back to profile"
              variant="ghost"
              onPress={() => router.replace(`/parent/${document.parentId}`)}
            />
          </>
        ) : (
          <Button
            label="Continue in the background"
            variant="ghost"
            onPress={() => router.replace(`/parent/${document.parentId}`)}
            testID="processing-background"
            accessibilityHint="Leaves this screen. Processing carries on."
          />
        )
      }
    >
      <View style={styles.header}>
        <View
          style={[
            styles.statusIcon,
            phase === 'ready'
              ? styles.statusIconReady
              : phase === 'failed'
                ? styles.statusIconFailed
                : null,
          ]}
        >
          <Ionicons
            name={
              phase === 'ready'
                ? 'checkmark-circle'
                : phase === 'failed'
                  ? 'alert-circle'
                  : 'cloud-upload-outline'
            }
            size={44}
            color={
              phase === 'ready'
                ? colors.success
                : phase === 'failed'
                  ? colors.danger
                  : colors.primary
            }
          />
        </View>

        <Text variant="title" align="center" style={styles.title}>
          {phase === 'ready'
            ? 'Ready to read'
            : phase === 'failed'
              ? 'Something went wrong'
              : phase === 'uploading'
                ? 'Uploading'
                : 'Reading the document'}
        </Text>

        <Text variant="callout" tone="secondary" align="center">
          {document.title} · {pluralise(document.pages.length, 'page')}
        </Text>
      </View>

      <Card style={styles.card}>
        <ProgressBar
          percent={uploadPercent}
          label="Upload"
          tone={phase === 'failed' && uploadPercent < 100 ? 'danger' : 'brand'}
          testID="processing-upload-progress"
        />
        <Text variant="caption" tone="muted" style={styles.uploadNote}>
          {uploadPercent === 100
            ? 'All pages uploaded and encrypted.'
            : 'Pages are sent straight to secure storage — they do not pass through our servers.'}
        </Text>
      </Card>

      <Card style={styles.card}>
        <Text variant="label" tone="secondary" style={styles.stagesTitle}>
          Processing
        </Text>

        {PROCESSING_STAGES.filter((item) => item !== 'done').map((item) => {
          const currentIndex = PROCESSING_STAGES.indexOf(stage);
          const itemIndex = PROCESSING_STAGES.indexOf(item);
          const done = phase === 'ready' || itemIndex < currentIndex;
          const active = phase === 'processing' && itemIndex === currentIndex;

          return (
            <View key={item} style={styles.stageRow}>
              <Ionicons
                name={done ? 'checkmark-circle' : active ? 'ellipse' : 'ellipse-outline'}
                size={22}
                color={done ? colors.success : active ? colors.primary : colors.borderStrong}
              />
              <Text
                variant="callout"
                tone={done || active ? 'primary' : 'muted'}
                style={styles.stageLabel}
              >
                {PROCESSING_STAGE_LABELS[item]}
              </Text>
            </View>
          );
        })}
      </Card>

      {error ? (
        <Callout tone="danger" title="Could not finish" message={error} testID="processing-error" />
      ) : null}

      <Callout
        tone="neutral"
        message="Summaries are generated automatically and can be wrong. Always check the original document and speak to a doctor before acting on anything."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  header: { alignItems: 'center', marginBottom: spacing.xl, paddingTop: spacing.xxl },
  stageLabel: { flex: 1 },
  stageRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  stagesTitle: { marginBottom: spacing.sm },
  statusIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.pill,
    height: 96,
    justifyContent: 'center',
    marginBottom: spacing.lg,
    width: 96,
  },
  statusIconFailed: { backgroundColor: colors.dangerSoft },
  statusIconReady: { backgroundColor: colors.successSoft },
  title: { marginBottom: spacing.xs },
  uploadNote: { marginTop: spacing.md },
});
