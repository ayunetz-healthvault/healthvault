import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Callout, ChipSelect, EmptyState, Screen, Text } from '@/components';
import { type CaptureOutcome, captureService } from '@/services/capture/captureService';
import { useCaptureStore } from '@/state/captureStore';
import { useVaultStore } from '@/state/vaultStore';
import { colors, radius, spacing } from '@/theme';
import { formatBytes } from '@/utils/format';

/**
 * Choose how the document gets in.
 *
 * All four routes converge on the same review screen, so the rest of the flow
 * does not care where the pages came from.
 */

interface SourceOption {
  key: 'scan' | 'camera' | 'gallery' | 'file';
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
}

const SOURCES: SourceOption[] = [
  {
    key: 'scan',
    icon: 'scan-outline',
    title: 'Scan a document',
    description: 'Best for multi-page reports. Capture page after page without leaving the camera.',
  },
  {
    key: 'camera',
    icon: 'camera-outline',
    title: 'Take a photo',
    description: 'A single quick picture of a prescription or slip.',
  },
  {
    key: 'gallery',
    icon: 'images-outline',
    title: 'Choose from photos',
    description: 'Pictures already on this phone — including ones a sibling sent you.',
  },
  {
    key: 'file',
    icon: 'document-attach-outline',
    title: 'Pick a PDF or image file',
    description: 'Reports emailed by a lab, or files saved in Drive or Files.',
  },
];

export default function CaptureScreen(): React.JSX.Element {
  const router = useRouter();
  const { parentId: parentIdParam } = useLocalSearchParams<{ parentId?: string }>();

  const parents = useVaultStore((state) => state.parents);
  const start = useCaptureStore((state) => state.start);
  const addPages = useCaptureStore((state) => state.addPages);
  const captureParentId = useCaptureStore((state) => state.parentId);

  const [selectedParentId, setSelectedParentId] = useState<string | null>(
    parentIdParam ?? parents[0]?.id ?? null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start a fresh draft whenever the target parent changes, so pages never end
  // up filed against the wrong person.
  useEffect(() => {
    if (selectedParentId && selectedParentId !== captureParentId) {
      start(selectedParentId);
    }
  }, [selectedParentId, captureParentId, start]);

  const handleOutcome = (outcome: CaptureOutcome): void => {
    switch (outcome.status) {
      case 'success':
        addPages(outcome.pages);
        router.push('/capture/review');
        break;
      case 'cancelled':
        break;
      case 'permission_denied':
        setNotice(
          outcome.permission === 'camera'
            ? 'Ayunetz needs camera access to photograph documents. You can turn it on in your phone’s settings.'
            : 'Ayunetz needs access to your photos to attach existing pictures. You can turn it on in your phone’s settings.',
        );
        break;
      case 'too_large':
        setNotice(
          `“${outcome.fileName}” is ${formatBytes(outcome.sizeBytes)}, which is over the upload limit. Try a smaller scan or split it into pages.`,
        );
        break;
      default:
        break;
    }
  };

  const handleSource = async (key: SourceOption['key']): Promise<void> => {
    if (!selectedParentId) return;
    setNotice(null);

    if (key === 'scan') {
      router.push('/capture/scan');
      return;
    }

    setBusy(true);
    try {
      const outcome =
        key === 'camera'
          ? await captureService.takePhoto()
          : key === 'gallery'
            ? await captureService.pickFromGallery()
            : await captureService.pickFile();
      handleOutcome(outcome);
    } catch {
      setNotice('Something went wrong opening that. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (parents.length === 0) {
    return (
      <Screen testID="capture-no-parents">
        <EmptyState
          icon="person-add-outline"
          title="Add a parent first"
          message="Documents are filed against a person, so create a profile before adding reports."
          actionLabel="Add a parent"
          onAction={() => router.replace('/parent/new')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      testID="capture"
      footer={
        <Button
          label="Cancel"
          variant="ghost"
          onPress={() => router.back()}
          testID="capture-cancel"
        />
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Add a document
      </Text>

      {parents.length > 1 ? (
        <ChipSelect
          label="Whose document is this?"
          options={parents.map((parent) => ({ value: parent.id, label: parent.fullName }))}
          value={selectedParentId ?? parents[0]!.id}
          onChange={setSelectedParentId}
          testID="capture-parent"
        />
      ) : (
        <Text variant="callout" tone="secondary" style={styles.singleParent}>
          For {parents[0]?.fullName}
        </Text>
      )}

      {notice ? <Callout tone="warning" message={notice} testID="capture-notice" /> : null}

      <View style={styles.sources}>
        {SOURCES.map((source) => (
          <Pressable
            key={source.key}
            onPress={() => void handleSource(source.key)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${source.title}. ${source.description}`}
            accessibilityState={{ disabled: busy }}
            testID={`capture-source-${source.key}`}
            style={({ pressed }) => [
              styles.source,
              pressed ? styles.sourcePressed : null,
              busy ? styles.sourceDisabled : null,
            ]}
          >
            <View style={styles.sourceIcon}>
              <Ionicons name={source.icon} size={28} color={colors.primary} />
            </View>
            <View style={styles.sourceBody}>
              <Text variant="subheading">{source.title}</Text>
              <Text variant="caption" tone="secondary" style={styles.sourceDescription}>
                {source.description}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>

      <Callout
        tone="neutral"
        message="Keep the original paper copy. Ayunetz stores a picture of the document, not a certified medical record."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.xl, marginTop: spacing.lg },
  singleParent: { marginBottom: spacing.xl },
  source: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    minHeight: 96,
    padding: spacing.lg,
  },
  sourceBody: { flex: 1, gap: spacing.xxs },
  sourceDescription: { paddingRight: spacing.sm },
  sourceDisabled: { opacity: 0.6 },
  sourceIcon: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  sourcePressed: { backgroundColor: colors.surfaceMuted },
  sources: { gap: spacing.md, marginBottom: spacing.xxl },
});
