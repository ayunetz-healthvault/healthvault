import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Callout, Screen, Text, TextField } from '@/components';
import { AuthError, authService } from '@/services/auth/authService';
import { spacing } from '@/theme';

/**
 * Password recovery, in two steps on one screen.
 *
 * The screen does not say whether the address exists. Cognito's own
 * `ForgotPassword` deliberately answers the same way for an unknown address,
 * and repeating that answer here matters: "no account with that email" turns
 * this form into a way to find out who has an account with a health app.
 */
type Stage = 'request' | 'confirm';

export default function ResetPasswordScreen(): React.JSX.Element {
  const router = useRouter();

  const [stage, setStage] = useState<Stage>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const report = (caught: unknown, fallback: string): void => {
    setError(caught instanceof AuthError ? caught.message : fallback);
  };

  const handleRequest = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await authService.requestPasswordReset(email);
      setStage('confirm');
    } catch (caught) {
      report(caught, 'We could not start a password reset just now.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      await authService.confirmPasswordReset(email, code, password);
      router.replace('/sign-in');
    } catch (caught) {
      report(caught, 'We could not set that password. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen
      testID="reset-password"
      footer={
        <>
          <Button
            label={stage === 'request' ? 'Send a reset code' : 'Set my new password'}
            onPress={() => void (stage === 'request' ? handleRequest() : handleConfirm())}
            loading={submitting}
            testID="reset-submit"
          />
          <Button
            label="Back to sign in"
            variant="ghost"
            onPress={() => router.replace('/sign-in')}
            testID="reset-back"
          />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Reset your password
      </Text>

      {stage === 'request' ? (
        <Text variant="body" tone="secondary">
          Enter your email address and we will send a code. If there is an account with that
          address, the code will arrive in a few minutes.
        </Text>
      ) : (
        <Text variant="body" tone="secondary">
          Enter the code we sent to {email}, then choose a new password.
        </Text>
      )}

      {error === null ? null : <Callout tone="danger" message={error} testID="reset-error" />}

      <TextField
        label="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        editable={stage === 'request'}
        testID="reset-email"
      />

      {stage === 'confirm' ? (
        <>
          <TextField
            label="Code from the email"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            testID="reset-code"
          />
          <TextField
            label="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="new-password"
            hint="At least 8 characters."
            testID="reset-new-password"
          />
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.sm },
});
