import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  ChipSelect,
  ConfirmDialog,
  DocumentCard,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components';
import { accountService } from '@/services/account/accountService';
import { useSessionStore } from '@/state/sessionStore';
import { useVaultSnapshot, useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';
import { pluralise } from '@/utils/format';

type Mode = 'documents' | 'account';

/**
 * Deletion.
 *
 * Two separate paths, because they are very different decisions: removing one
 * report is routine, closing the account is not. Account deletion is gated on
 * typing DELETE, and is described honestly — including the grace period and
 * what actually gets erased.
 */
export default function DeleteDataScreen(): React.JSX.Element {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('documents');

  const vault = useVaultSnapshot();
  const removeDocument = useVaultStore((state) => state.removeDocument);
  const clearAll = useVaultStore((state) => state.clearAll);
  const signOut = useSessionStore((state) => state.signOut);

  const [pendingDocumentId, setPendingDocumentId] = useState<string | null>(null);
  const [wipeVisible, setWipeVisible] = useState(false);
  const [accountVisible, setAccountVisible] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Records only this account can reach, which block an account deletion. */
  const [blocked, setBlocked] = useState<string[]>([]);

  const pendingDocument = vault.documents.find((doc) => doc.id === pendingDocumentId);

  const handleDeleteDocument = async (): Promise<void> => {
    if (!pendingDocumentId || pendingDocument === undefined) return;
    setBusy(true);
    // The record it belongs to, not the account deleting it: the backend checks
    // the grant on that record before removing anything. See ADR-005.
    await accountService.deleteDocument(pendingDocument.parentId, pendingDocumentId);
    removeDocument(pendingDocumentId);
    setBusy(false);
    setPendingDocumentId(null);
    setNotice('Document and its summary deleted.');
  };

  const handleWipeDevice = async (): Promise<void> => {
    setBusy(true);
    clearAll();
    await accountService.wipeLocalData();
    setBusy(false);
    setWipeVisible(false);
    setNotice('Everything stored on this phone has been removed.');
  };

  const confirmMatches = confirmText.trim().toUpperCase() === 'DELETE';

  const handleDeleteAccount = async (): Promise<void> => {
    // Belt and braces: the button is disabled below, but this guard means a
    // stray call can never erase an account without the typed confirmation.
    if (!confirmMatches) return;

    setBusy(true);
    const result = await accountService.requestAccountDeletion();

    /**
     * Refused, and nothing has been removed.
     *
     * These records would be left with nobody who can reach them — including
     * nobody who could delete them later. The alternatives are both worse:
     * stranding them, or deleting somebody's medical history because a
     * different request was made. So the person is told which records, and
     * asked to hand them over or delete them first.
     */
    if (result.outcome === 'records_would_be_stranded') {
      setBusy(false);
      setAccountVisible(false);
      setBlocked(result.patientIds);
      return;
    }

    clearAll();
    await accountService.wipeLocalData();
    await signOut();
    setBusy(false);
    setAccountVisible(false);
    router.replace('/sign-in?accountDeleted=1');
  };

  return (
    <Screen testID="settings-delete-screen">
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Delete data
      </Text>

      <ChipSelect
        label="What do you want to delete?"
        options={[
          { value: 'documents' as const, label: 'A document' },
          { value: 'account' as const, label: 'My whole account' },
        ]}
        value={mode}
        onChange={setMode}
        testID="delete-mode"
      />

      {notice ? <Callout tone="success" message={notice} testID="delete-notice" /> : null}

      {mode === 'documents' ? (
        <>
          <Callout
            tone="warning"
            message="Deleting a document removes the stored pages and its summary from your phone and from secure storage. Follow-ups created from it are kept."
          />

          <SectionHeader
            title="Your documents"
            subtitle={
              vault.documents.length === 0
                ? undefined
                : `${pluralise(vault.documents.length, 'document')} stored`
            }
          />

          {vault.documents.length === 0 ? (
            <EmptyState
              icon="documents-outline"
              title="Nothing stored"
              message="There are no documents to delete."
              testID="delete-no-documents"
            />
          ) : (
            vault.documents.map((document) => (
              <DocumentCard
                key={document.id}
                document={document}
                onPress={() => setPendingDocumentId(document.id)}
                testID={`delete-document-${document.id}`}
              />
            ))
          )}

          <View style={styles.wipeSection}>
            <Button
              label="Remove everything from this phone"
              variant="secondary"
              icon="phone-portrait-outline"
              onPress={() => setWipeVisible(true)}
              testID="delete-wipe-device"
            />
            <Text variant="caption" tone="muted" style={styles.wipeNote}>
              Clears the local copy only. Your account and anything already uploaded stay as they
              are.
            </Text>
          </View>
        </>
      ) : (
        <>
          <Callout
            tone="danger"
            title="This removes your access"
            /*
              Says what actually happens, which is not what this screen used to
              promise. There is no grace period — nothing on the server
              implements one — and closing an account does not delete records
              other people still hold. A record shared with a sibling is that
              person's record too.
            */
            message="This removes your access to every record you can reach, and wipes this phone. Records other people can still reach are not deleted — they keep theirs. Anything only you can reach has to be deleted first, and this will tell you which."
          />

          {blocked.length === 0 ? null : (
            <Callout
              tone="warning"
              title="Some records would be left with nobody"
              message={`${pluralise(blocked.length, 'record')} can only be reached by you. Open each one and either delete it, or give somebody else access, then try again. Nothing has been removed.`}
              testID="delete-account-blocked"
            />
          )}

          <SectionHeader title="What happens on this phone" />
          <Card>
            {[
              `${pluralise(vault.parents.length, 'profile')} removed from this device`,
              `${pluralise(vault.documents.length, 'document')} and their pages removed from this device`,
              `${pluralise(vault.summaries.length, 'summary')} removed from this device`,
              `${pluralise(vault.followUps.length, 'follow-up')} removed from this device`,
              'Your sign-in is deleted separately, by the service that holds it',
            ].map((line) => (
              <View key={line} style={styles.bulletRow}>
                <Text variant="callout" tone="secondary">
                  •
                </Text>
                <Text variant="callout" style={styles.bulletText}>
                  {line}
                </Text>
              </View>
            ))}
          </Card>

          <Callout
            tone="neutral"
            message="Calendar events already added to your phone are not removed automatically — delete those in your calendar app if you want them gone."
          />

          <Button
            label="Delete my account"
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              setConfirmText('');
              setAccountVisible(true);
            }}
            style={styles.deleteAccount}
            testID="delete-account"
          />
        </>
      )}

      <ConfirmDialog
        visible={pendingDocument !== undefined}
        title="Delete this document?"
        message={
          pendingDocument
            ? `“${pendingDocument.title}” and its summary will be permanently deleted. This cannot be undone.`
            : ''
        }
        confirmLabel="Delete permanently"
        destructive
        loading={busy}
        onConfirm={() => void handleDeleteDocument()}
        onCancel={() => setPendingDocumentId(null)}
        testID="delete-document-dialog"
      />

      <ConfirmDialog
        visible={wipeVisible}
        title="Remove local copy?"
        message="Everything cached on this phone will be cleared. You will need to sign in again to download your records."
        confirmLabel="Remove from this phone"
        destructive
        loading={busy}
        onConfirm={() => void handleWipeDevice()}
        onCancel={() => setWipeVisible(false)}
        testID="delete-wipe-dialog"
      />

      <ConfirmDialog
        visible={accountVisible}
        title="Delete your account?"
        message="Type DELETE below to confirm. This starts the erasure process and signs you out."
        confirmLabel="Delete my account"
        destructive
        loading={busy}
        confirmDisabled={!confirmMatches}
        onConfirm={() => void handleDeleteAccount()}
        onCancel={() => setAccountVisible(false)}
        testID="delete-account-dialog"
      >
        <TextField
          label="Type DELETE to confirm"
          value={confirmText}
          onChangeText={setConfirmText}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="DELETE"
          error={confirmText.length > 0 && !confirmMatches ? 'That does not match.' : undefined}
          testID="delete-confirm-input"
        />
      </ConfirmDialog>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bulletRow: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.xs },
  bulletText: { flex: 1 },
  deleteAccount: { marginTop: spacing.xxl },
  heading: { marginBottom: spacing.xl, marginTop: spacing.lg },
  wipeNote: { marginTop: spacing.sm },
  wipeSection: { marginTop: spacing.xxl },
});
