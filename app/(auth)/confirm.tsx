import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, Callout, Screen, Text, TextField } from '@/components';
import { AuthError, authService } from '@/services/auth/authService';
import { useSessionStore } from '@/state/sessionStore';
import { spacing } from '@/theme';

/**
 * The emailed confirmation code.
 *
 * A separate screen rather than a field on sign-up, because the user has to
 * leave the app to read the code and will come back to whatever was on screen.
 *
 * The password is asked for again rather than carried from the previous screen.
 * Holding it in navigation parameters would put it in the router's history and
 * in any state snapshot taken while the user is away in their mail app.
 */
export default function ConfirmScreen(): React.JSX.Element {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const signIn = useSessionStore((state) => state.signIn);

  const [email] = useState(params.email ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const report = (caught: unknown, fallback: string): void => {
    setError(caught instanceof AuthError ? caught.message : fallback);
  };

  const handleConfirm = async (): Promise<void> => {
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await signIn(await authService.confirmSignUp(email, code, password));
      router.replace('/');
    } catch (caught) {
      report(caught, 'We could not confirm that code. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async (): Promise<void> => {
    setError(null);
    try {
      await authService.resendConfirmationCode(email);
      setNotice('We have sent another code. It can take a minute to arrive.');
    } catch (caught) {
      report(caught, 'We could not send another code just now.');
    }
  };

  return (
    <Screen
      testID="confirm"
      footer={
        <>
          <Button
            label="Confirm and sign in"
            onPress={() => void handleConfirm()}
            loading={submitting}
            testID="confirm-submit"
          />
          <Button
            label="Send the code again"
            variant="ghost"
            onPress={() => void handleResend()}
            testID="confirm-resend"
          />
        </>
      }
    >
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Check your email
      </Text>
      <Text variant="body" tone="secondary">
        We sent a code to {email || 'your email address'}. Enter it below to finish setting up your
        account.
      </Text>

      {notice === null ? null : (
        <Callout tone="success" message={notice} testID="confirm-notice" />
      )}
      {error === null ? null : <Callout tone="danger" message={error} testID="confirm-error" />}

      <TextField
        label="Code from the email"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        testID="confirm-code"
      />
      <TextField
        label="Your password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="new-password"
        hint="The password you just chose, so we can sign you in."
        testID="confirm-password"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.sm },
});
