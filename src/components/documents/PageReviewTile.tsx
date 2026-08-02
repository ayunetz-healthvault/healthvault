import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '../ui';

import { colors, radius, spacing, touchTarget } from '@/theme';
import type { DocumentPage } from '@/types/domain';
import { formatBytes, truncate } from '@/utils/format';

export interface PageReviewTileProps {
  page: DocumentPage;
  index: number;
  total: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRetake: () => void;
  onRemove: () => void;
  testID?: string | undefined;
}

const SOURCE_LABELS: Record<DocumentPage['source'], string> = {
  scan: 'Scanned',
  camera: 'Photo',
  gallery: 'From gallery',
  file: 'File',
};

/**
 * One page in the review list, with its four actions.
 *
 * Reordering uses explicit up/down buttons rather than drag-and-drop. Dragging
 * a thumbnail is a precision gesture, and the people using this app are often
 * doing it one-handed on a phone call — buttons are slower but they never fail.
 */
export function PageReviewTile({
  page,
  index,
  total,
  onMoveUp,
  onMoveDown,
  onRetake,
  onRemove,
  testID,
}: PageReviewTileProps): React.JSX.Element {
  const position = `Page ${index + 1} of ${total}`;
  const isFirst = index === 0;
  const isLast = index === total - 1;

  return (
    <View style={styles.tile} testID={testID}>
      <View style={styles.preview}>
        {page.kind === 'pdf' ? (
          <View style={styles.pdfPreview}>
            <Ionicons name="document-text" size={30} color={colors.primary} />
            <Text variant="caption" tone="secondary">
              PDF
            </Text>
          </View>
        ) : (
          <Image
            source={{ uri: page.uri }}
            style={styles.image}
            contentFit="cover"
            transition={150}
            accessibilityIgnoresInvertColors
            accessible
            accessibilityLabel={`Preview of ${position}`}
          />
        )}
        <View style={styles.pageBadge}>
          <Text variant="caption" tone="inverse" style={styles.pageBadgeText}>
            {index + 1}
          </Text>
        </View>
      </View>

      <View style={styles.details}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {position}
        </Text>
        <Text variant="caption" tone="secondary" numberOfLines={1}>
          {SOURCE_LABELS[page.source]}
          {page.sizeBytes > 0 ? ` · ${formatBytes(page.sizeBytes)}` : ''}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {truncate(page.fileName, 28)}
        </Text>

        <View style={styles.actions}>
          <IconAction
            icon="arrow-up"
            label={`Move ${position} up`}
            onPress={onMoveUp}
            disabled={isFirst}
            testID={testID ? `${testID}-up` : undefined}
          />
          <IconAction
            icon="arrow-down"
            label={`Move ${position} down`}
            onPress={onMoveDown}
            disabled={isLast}
            testID={testID ? `${testID}-down` : undefined}
          />
          <IconAction
            icon="camera-reverse-outline"
            label={`Retake ${position}`}
            onPress={onRetake}
            testID={testID ? `${testID}-retake` : undefined}
          />
          <IconAction
            icon="trash-outline"
            label={`Remove ${position}`}
            onPress={onRemove}
            destructive
            testID={testID ? `${testID}-remove` : undefined}
          />
        </View>
      </View>
    </View>
  );
}

interface IconActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean | undefined;
  destructive?: boolean | undefined;
  testID?: string | undefined;
}

function IconAction({
  icon,
  label,
  onPress,
  disabled = false,
  destructive = false,
  testID,
}: IconActionProps): React.JSX.Element {
  const tint = disabled ? colors.textMuted : destructive ? colors.danger : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.iconAction,
        destructive ? styles.iconActionDestructive : null,
        disabled ? styles.iconActionDisabled : null,
        pressed ? styles.iconActionPressed : null,
      ]}
    >
      <Ionicons name={icon} size={22} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  details: { flex: 1, gap: spacing.xxs },
  iconAction: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    height: touchTarget.min - 8,
    justifyContent: 'center',
    width: touchTarget.min - 8,
  },
  iconActionDestructive: { backgroundColor: colors.dangerSoft },
  iconActionDisabled: { backgroundColor: colors.surfaceMuted },
  iconActionPressed: { opacity: 0.7 },
  image: { height: '100%', width: '100%' },
  pageBadge: {
    alignItems: 'center',
    backgroundColor: colors.textPrimary,
    borderRadius: radius.pill,
    bottom: spacing.xs,
    height: 26,
    justifyContent: 'center',
    left: spacing.xs,
    position: 'absolute',
    width: 26,
  },
  pageBadgeText: { fontWeight: '700' },
  pdfPreview: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  preview: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    height: 132,
    overflow: 'hidden',
    width: 100,
  },
  tile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
});
