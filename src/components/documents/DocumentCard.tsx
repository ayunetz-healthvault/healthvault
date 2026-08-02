import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Badge, Card, Text } from '../ui';

import { colors, spacing } from '@/theme';
import type { DocumentCategory, MedicalDocument, ProcessingStatus } from '@/types/domain';
import { DOCUMENT_CATEGORY_LABELS, PROCESSING_STATUS_LABELS } from '@/types/labels';
import { formatDate } from '@/utils/date';
import { pluralise } from '@/utils/format';

export interface DocumentCardProps {
  document: MedicalDocument;
  onPress: () => void;
  testID?: string | undefined;
}

const CATEGORY_ICONS: Record<DocumentCategory, keyof typeof Ionicons.glyphMap> = {
  lab_report: 'flask-outline',
  prescription: 'receipt-outline',
  discharge_summary: 'document-text-outline',
  imaging: 'scan-outline',
  consultation_note: 'chatbubble-ellipses-outline',
  insurance: 'shield-outline',
  other: 'document-outline',
};

const STATUS_TONES = {
  draft: 'neutral',
  uploading: 'info',
  uploaded: 'info',
  processing: 'info',
  ready: 'success',
  failed: 'danger',
} as const satisfies Record<ProcessingStatus, 'neutral' | 'info' | 'success' | 'danger'>;

export function DocumentCard({ document, onPress, testID }: DocumentCardProps): React.JSX.Element {
  const meta = `${formatDate(document.documentDate)} · ${pluralise(document.pages.length, 'page')}`;

  return (
    <Card
      onPress={onPress}
      testID={testID}
      accessibilityLabel={`${document.title}. ${DOCUMENT_CATEGORY_LABELS[document.category]}. ${meta}. ${PROCESSING_STATUS_LABELS[document.status]}`}
      accessibilityHint={
        document.status === 'ready' ? 'Opens the summary' : 'Opens the processing status'
      }
      style={styles.card}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name={CATEGORY_ICONS[document.category]} size={24} color={colors.primary} />
        </View>

        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {document.title}
          </Text>
          <Text variant="caption" tone="secondary" numberOfLines={1}>
            {meta}
          </Text>
          <View style={styles.badges}>
            <Badge label={DOCUMENT_CATEGORY_LABELS[document.category]} tone="neutral" />
            {document.status === 'ready' ? (
              <Badge label="Summary ready" tone="success" icon="sparkles" />
            ) : (
              <Badge
                label={PROCESSING_STATUS_LABELS[document.status]}
                tone={STATUS_TONES[document.status]}
              />
            )}
          </View>
        </View>

        <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  body: { flex: 1, gap: spacing.xxs },
  card: { marginBottom: spacing.md },
  iconWrap: {
    alignItems: 'center',
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  row: { alignItems: 'flex-start', flexDirection: 'row', gap: spacing.lg },
});
