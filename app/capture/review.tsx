import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Button,
  Callout,
  ChipSelect,
  ConfirmDialog,
  EmptyState,
  PageReviewTile,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components';
import { type CaptureOutcome, captureService } from '@/services/capture/captureService';
import { isCaptureReady, useCaptureStore } from '@/state/captureStore';
import { useVaultStore } from '@/state/vaultStore';
import { colors, radius, spacing } from '@/theme';
import type { DocumentCategory, MedicalDocument } from '@/types/domain';
import { DOCUMENT_CATEGORY_LABELS, DOCUMENT_CATEGORY_OPTIONS } from '@/types/labels';
import { isValidIsoDate, nowIso } from '@/utils/date';
import { pluralise } from '@/utils/format';
import { createId } from '@/utils/id';

/**
 * Review before upload: reorder, remove, retake, add more pages, and label the
 * document. Nothing leaves the phone until "Upload" is tapped here.
 */
export default function ReviewScreen(): React.JSX.Element {
  const router = useRouter();

  const capture = useCaptureStore();
  const parents = useVaultStore((state) => state.parents);
  const addDocument = useVaultStore((state) => state.addDocument);

  const [discardVisible, setDiscardVisible] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [titleTouched, setTitleTouched] = useState(false);

  const parent = parents.find((item) => item.id === capture.parentId);
  const ready = isCaptureReady(capture);

  const handleAddMore = async (source: 'camera' | 'gallery' | 'file' | 'scan'): Promise<void> => {
    setNotice(null);
    if (source === 'scan') {
      router.push('/capture/scan');
      return;
    }

    const outcome: CaptureOutcome =
      source === 'camera'
        ? await captureService.takePhoto()
        : source === 'gallery'
          ? await captureService.pickFromGallery()
          : await captureService.pickFile();

    if (outcome.status === 'success') capture.addPages(outcome.pages);
    else if (outcome.status === 'permission_denied')
      setNotice('Permission was not granted, so nothing was added.');
    else if (outcome.status === 'too_large')
      setNotice(`“${outcome.fileName}” is too large to upload.`);
  };

  const handleUpload = (): void => {
    setTitleTouched(true);
    if (!isValidIsoDate(capture.documentDate)) {
      setDateError('Enter the date as YYYY-MM-DD.');
      return;
    }
    setDateError(undefined);
    if (!ready || !capture.parentId) return;

    const document: MedicalDocument = {
      id: createId('doc'),
      parentId: capture.parentId,
      title: capture.title.trim(),
      category: capture.category,
      documentDate: capture.documentDate,
      pages: capture.pages,
      // Upload actually starts on the processing screen, which owns the
      // progress UI; this record exists first so it survives a backgrounded app.
      status: 'draft',
      uploadProgress: 0,
      summaryId: null,
      failureReason: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    addDocument(document);
    capture.reset();
    router.replace(`/document/${document.id}/processing`);
  };

  const handleDiscard = (): void => {
    setDiscardVisible(false);
    capture.reset();
    router.dismissAll();
    router.replace('/(tabs)');
  };

  if (capture.pages.length === 0) {
    return (
      <Screen testID="review-empty">
        <EmptyState
          icon="images-outline"
          title="No pages yet"
          message="Go back and scan, photograph or pick the document you want to add."
          actionLabel="Add pages"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="review"
      footer={
        <>
          <Button
            label={`Upload ${pluralise(capture.pages.length, 'page')}`}
            icon="cloud-upload-outline"
            onPress={handleUpload}
            disabled={!ready}
            testID="review-upload"
            accessibilityHint={
              ready
                ? 'Uploads the document and starts processing'
                : 'Give the document a title first'
            }
          />
          <Button
            label="Discard"
            variant="ghost"
            onPress={() => setDiscardVisible(true)}
            testID="review-discard"
          />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Check the pages
      </Text>
      <Text variant="callout" tone="secondary" style={styles.intro}>
        Put them in the right order and remove anything blurred. This is what gets read.
      </Text>

      {notice ? <Callout tone="warning" message={notice} testID="review-notice" /> : null}

      <SectionHeader
        title={pluralise(capture.pages.length, 'page')}
        subtitle={parent ? `For ${parent.fullName}` : undefined}
      />

      {capture.pages.map((page, index) => (
        <PageReviewTile
          key={page.id}
          page={page}
          index={index}
          total={capture.pages.length}
          onMoveUp={() => capture.movePage(page.id, -1)}
          onMoveDown={() => capture.movePage(page.id, 1)}
          onRetake={() => router.push(`/capture/scan?retakePageId=${page.id}`)}
          onRemove={() => capture.removePage(page.id)}
          testID={`review-page-${index}`}
        />
      ))}

      <View style={styles.addMore}>
        {(
          [
            { key: 'scan', icon: 'scan-outline', label: 'Scan' },
            { key: 'camera', icon: 'camera-outline', label: 'Photo' },
            { key: 'gallery', icon: 'images-outline', label: 'Gallery' },
            { key: 'file', icon: 'document-attach-outline', label: 'File' },
          ] as const
        ).map((option) => (
          <Pressable
            key={option.key}
            onPress={() => void handleAddMore(option.key)}
            accessibilityRole="button"
            accessibilityLabel={`Add more pages: ${option.label}`}
            testID={`review-add-${option.key}`}
            style={({ pressed }) => [styles.addChip, pressed ? styles.addChipPressed : null]}
          >
            <Ionicons name={option.icon} size={22} color={colors.primary} />
            <Text variant="caption" tone="brand">
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <SectionHeader title="Label this document" />

      <TextField
        label="Title"
        value={capture.title}
        onChangeText={(value) => capture.setMeta({ title: value })}
        placeholder="Quarterly diabetes panel"
        required
        error={
          titleTouched && capture.title.trim().length === 0
            ? 'Give the document a short title.'
            : undefined
        }
        testID="review-title"
      />

      <ChipSelect
        label="What kind of document is it?"
        options={DOCUMENT_CATEGORY_OPTIONS.map((value) => ({
          value,
          label: DOCUMENT_CATEGORY_LABELS[value],
        }))}
        value={capture.category}
        onChange={(value: DocumentCategory) => capture.setMeta({ category: value })}
        testID="review-category"
      />

      <TextField
        label="Date on the document"
        value={capture.documentDate}
        onChangeText={(value) => {
          capture.setMeta({ documentDate: value });
          setDateError(undefined);
        }}
        placeholder="2026-07-12"
        keyboardType="numbers-and-punctuation"
        hint="The date printed on the report, not today's date."
        error={dateError}
        testID="review-date"
      />

      <ConfirmDialog
        visible={discardVisible}
        title="Discard this document?"
        message={`${pluralise(capture.pages.length, 'page')} will be thrown away. Nothing has been uploaded yet.`}
        confirmLabel="Discard"
        destructive
        onConfirm={handleDiscard}
        onCancel={() => setDiscardVisible(false)}
        testID="review-discard-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  addChip: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xxs,
    justifyContent: 'center',
    minHeight: 72,
    paddingVertical: spacing.md,
  },
  addChipPressed: { opacity: 0.75 },
  addMore: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  heading: { marginBottom: spacing.sm, marginTop: spacing.lg },
  intro: { marginBottom: spacing.lg },
});
