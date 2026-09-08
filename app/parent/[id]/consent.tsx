import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  ListRow,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { isBackendEnabled } from '@/config/env';
import {
  CONSENT_COPY,
  consentService,
  type ConsentPurpose,
  type ConsentView,
} from '@/services/consent/consentService';
import { selectParent, useVaultSnapshot } from '@/state/vaultStore';
import { spacing } from '@/theme';
import { formatDateTime } from '@/utils/date';

/**
 * What this person has agreed to, and the ability to change it.
 *
 * ## Why this is per-record and not in settings
 *
 * The agreement is about one person's health data, not about the account that
 * happens to be holding it. A caregiver may look after a parent who wants
 * summaries and an aunt who does not, and one switch in settings cannot express
 * that without quietly deciding for one of them.
 *
 * ## Three things this screen refuses to do
 *
 * 1. **Show a state it is not sure about.** If the server cannot be reached,
 *    the switches are not rendered as "off" — off is an answer, and guessing it
 *    would tell somebody their reports are not being read when they may be.
 * 2. **Treat withdrawal as a toggle.** Turning something off states plainly
 *    what it does and does not undo, including that text already sent to a
 *    provider cannot be recalled.
 * 3. **Hide who answered.** A row answered by a manager on the patient's behalf
 *    says so, because that is a materially weaker thing than the person
 *    agreeing themselves.
 */
export default function ConsentScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const vault = useVaultSnapshot();
  const parent = id ? selectParent(vault, id) : undefined;

  const [view, setView] = useState<ConsentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [withdrawing, setWithdrawing] = useState<ConsentPurpose | null>(null);

  /**
   * Derived at render rather than set in an effect.
   *
   * A build with no server has nothing to load and nothing to say about
   * consent, and that is a fact about the build, not a state to fetch.
   */
  const serverAvailable = isBackendEnabled();

  /**
   * Written as a promise chain rather than `await` in an effect body.
   *
   * The state updates then happen in callbacks, after the fetch resolves,
   * rather than synchronously while React is still committing the effect.
   */
  const load = useCallback((): void => {
    if (!id || !serverAvailable) return;

    void consentService.current(id).then(
      (next) => {
        setView(next);
        setError(null);
      },
      () => {
        // Deliberately not "off". An unknown answer is not a "no", and showing
        // one would be a claim about somebody's data this screen cannot make.
        setView(null);
        setError('What has been agreed could not be loaded, so it is not shown here.');
      },
    );
  }, [id, serverAvailable]);

  useEffect(load, [load]);

  const submit = async (purpose: ConsentPurpose, granted: boolean): Promise<void> => {
    if (!id || view === null) return;

    setBusy(true);
    setNotice(null);
    try {
      const result = await consentService.decide({
        patientId: id,
        purpose,
        granted,
        noticeVersion: view.noticeVersion,
      });

      if (result.outcome === 'notice_changed') {
        setNotice('The wording of this has changed since the screen opened. Please read it again.');
        load();
        return;
      }

      setView(result.view);
    } catch {
      setNotice('That could not be saved. Nothing has changed.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = (purpose: ConsentPurpose, next: boolean): void => {
    // Agreeing is one tap. Withdrawing states its consequences first — they are
    // not symmetrical, and one of them is irreversible.
    if (next) void submit(purpose, true);
    else setWithdrawing(purpose);
  };

  if (!parent) {
    return (
      <Screen testID="consent-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Profile not found"
          message="This profile may have been deleted."
          actionLabel="Back to home"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const withdrawal = view?.consent.find((entry) => entry.purpose === withdrawing);

  return (
    <Screen
      testID="consent-screen"
      onRefresh={load}
      refreshing={false}
      footer={<Button label="Done" onPress={() => router.back()} testID="consent-done" />}
    >
      <SectionHeader title={`What ${parent.fullName} has agreed to`} />

      <Text variant="callout" tone="secondary" style={styles.intro}>
        Each of these is separate. Agreeing to one does not agree to the others, and any of them
        can be changed later.
      </Text>

      {serverAvailable ? null : (
        <Callout
          tone="info"
          message="This is a demonstration build with no server, so nothing has been agreed and nothing is being processed."
          testID="consent-no-backend"
        />
      )}
      {error === null ? null : <Callout tone="warning" message={error} testID="consent-error" />}
      {notice === null ? null : <Callout tone="info" message={notice} testID="consent-notice" />}

      {view === null
        ? null
        : view.consent.map((entry) => (
            <Card key={entry.purpose} style={styles.card} testID={`consent-${entry.purpose}`}>
              <ListRow
                title={CONSENT_COPY[entry.purpose].title}
                subtitle={CONSENT_COPY[entry.purpose].description}
                toggle={{
                  value: entry.granted,
                  onValueChange: (next) => handleToggle(entry.purpose, next),
                }}
                disabled={busy}
                testID={`consent-toggle-${entry.purpose}`}
              />

              <View style={styles.meta}>
                {entry.needsReconsent && entry.decidedAt !== null ? (
                  <Badge label="Wording has changed" tone="warning" />
                ) : null}
                {entry.onBehalfOfPatient ? (
                  <Badge label="Answered by a family member" tone="neutral" />
                ) : null}
              </View>

              <Text variant="caption" tone="secondary">
                {entry.decidedAt === null
                  ? 'Not answered yet. Nothing is done under this heading until it is.'
                  : `Answered ${formatDateTime(entry.decidedAt)}.`}
              </Text>
            </Card>
          ))}

      <ConfirmDialog
        visible={withdrawing !== null}
        title="Turn this off?"
        message={withdrawal?.withdrawalEffect ?? ''}
        confirmLabel="Turn it off"
        onConfirm={() => {
          const purpose = withdrawing;
          setWithdrawing(null);
          if (purpose) void submit(purpose, false);
        }}
        onCancel={() => setWithdrawing(null)}
        testID="consent-withdraw-confirm"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { marginBottom: spacing.md },
  card: { marginBottom: spacing.md, gap: spacing.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
