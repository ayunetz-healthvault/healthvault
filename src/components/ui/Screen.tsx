import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme';

export interface ScreenProps {
  /** Optional so a screen can render an empty shell while it waits on a permission. */
  children?: ReactNode | undefined;
  /** Set false for screens that own their own list scrolling (FlatList etc.). */
  scrollable?: boolean | undefined;
  /** Pinned to the bottom above the safe area — used for primary actions. */
  footer?: ReactNode | undefined;
  padded?: boolean | undefined;
  onRefresh?: (() => void) | undefined;
  refreshing?: boolean | undefined;
  background?: string | undefined;
  contentStyle?: ViewStyle | undefined;
  testID?: string | undefined;
}

/**
 * Page shell: safe-area padding, keyboard avoidance and an optional sticky
 * footer. Keeping the footer outside the scroll view means the primary action
 * stays reachable with a thumb no matter how long the form is.
 */
export function Screen({
  children,
  scrollable = true,
  footer,
  padded = true,
  onRefresh,
  refreshing = false,
  background = colors.background,
  contentStyle,
  testID,
}: ScreenProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  const body = scrollable ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        padded ? styles.padded : null,
        { paddingBottom: spacing.xxxl },
        contentStyle,
      ]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...(onRefresh
        ? { refreshControl: <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> }
        : {})}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded ? styles.padded : null, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      testID={testID}
      style={[styles.flex, { backgroundColor: background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          {footer}
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  padded: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
});
