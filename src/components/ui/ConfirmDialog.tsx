import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { Button } from './Button';
import { Text } from './Text';

import { colors, radius, spacing } from '@/theme';

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  /** Extra detail rendered between the message and the buttons. */
  children?: ReactNode | undefined;
  confirmLabel: string;
  cancelLabel?: string | undefined;
  destructive?: boolean | undefined;
  loading?: boolean | undefined;
  /** Blocks confirmation until a precondition is met (e.g. type-to-confirm). */
  confirmDisabled?: boolean | undefined;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string | undefined;
}

/**
 * Explicit confirmation.
 *
 * Used for exactly the actions that deserve one: writing to the device
 * calendar, deleting a document, and deleting an account. Cancel is listed
 * first and styled quietly so the destructive path is never the reflex tap.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <Pressable
        style={styles.backdrop}
        onPress={loading ? undefined : onCancel}
        accessible={false}
      >
        <Pressable
          style={styles.sheet}
          onPress={(event) => event.stopPropagation()}
          testID={testID}
          accessibilityViewIsModal
          accessibilityLabel={title}
        >
          <Text variant="heading" accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Text variant="callout" tone="secondary">
            {message}
          </Text>

          {children ? <View style={styles.children}>{children}</View> : null}

          <View style={styles.actions}>
            <Button
              label={confirmLabel}
              onPress={onConfirm}
              variant={destructive ? 'danger' : 'primary'}
              loading={loading}
              disabled={confirmDisabled}
              testID={testID ? `${testID}-confirm` : undefined}
            />
            <Button
              label={cancelLabel}
              onPress={onCancel}
              variant="ghost"
              disabled={loading}
              testID={testID ? `${testID}-cancel` : undefined}
            />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.sm, marginTop: spacing.xl },
  backdrop: {
    alignItems: 'center',
    backgroundColor: colors.overlay,
    flex: 1,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  children: { marginTop: spacing.lg },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    maxWidth: 460,
    padding: spacing.xxl,
    width: '100%',
  },
  title: { marginBottom: spacing.sm },
});
