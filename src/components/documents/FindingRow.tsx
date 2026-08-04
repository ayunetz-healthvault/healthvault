import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '../ui';

import { SourceBadge } from './SourceBadge';

import { colors, radius, spacing } from '@/theme';
import type { FindingSeverity, SummaryFinding } from '@/types/domain';
import { FINDING_SEVERITY_LABELS } from '@/types/labels';

export interface FindingRowProps {
  finding: SummaryFinding;
  testID?: string | undefined;
}

const SEVERITY_STYLE: Record<
  FindingSeverity,
  { icon: keyof typeof Ionicons.glyphMap; color: string; background: string }
> = {
  normal: { icon: 'checkmark-circle', color: colors.success, background: colors.successSoft },
  watch: { icon: 'alert-circle', color: colors.warning, background: colors.warningSoft },
  attention: { icon: 'warning', color: colors.danger, background: colors.dangerSoft },
};

/**
 * One measured value from a report.
 *
 * The severity is carried by an icon *and* a written label, never colour on its
 * own — roughly 1 in 12 men has a colour-vision deficiency, and this is exactly
 * the kind of information that must not depend on seeing red.
 */
export function FindingRow({ finding, testID }: FindingRowProps): React.JSX.Element {
  const severity = SEVERITY_STYLE[finding.severity];

  return (
    <View
      style={styles.row}
      testID={testID}
      accessible
      accessibilityLabel={`${finding.label}: ${finding.value}. ${FINDING_SEVERITY_LABELS[finding.severity]}. ${finding.plainLanguage}`}
    >
      <View style={[styles.iconWrap, { backgroundColor: severity.background }]}>
        <Ionicons name={severity.icon} size={20} color={severity.color} />
      </View>

      <View style={styles.body}>
        <View style={styles.headline}>
          <Text variant="bodyStrong" style={styles.label} numberOfLines={2}>
            {finding.label}
          </Text>
          <Text variant="bodyStrong" style={{ color: severity.color }}>
            {finding.value}
          </Text>
        </View>

        {finding.referenceRange ? (
          <Text variant="caption" tone="muted">
            Normal range: {finding.referenceRange}
          </Text>
        ) : null}

        <Text variant="callout" tone="secondary" style={styles.plain}>
          {finding.plainLanguage}
        </Text>

        <Text variant="caption" style={[styles.severityLabel, { color: severity.color }]}>
          {FINDING_SEVERITY_LABELS[finding.severity]}
        </Text>

        <SourceBadge sources={finding.sources} testID={testID ? `${testID}-source` : undefined} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.xxs },
  headline: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: radius.pill,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  label: { flex: 1 },
  plain: { marginTop: spacing.xs },
  row: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  severityLabel: { fontWeight: '600', marginTop: spacing.xs },
});
