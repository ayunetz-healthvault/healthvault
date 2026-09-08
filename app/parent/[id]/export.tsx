import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import {
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
  TextField,
} from '@/components';
import { isBackendEnabled } from '@/config/env';
import { accountService } from '@/services/account/accountService';
import { selectParent, useVaultSnapshot, useVaultStore } from '@/state/vaultStore';
import { formatDateTime } from '@/utils/date';

/**
 * A copy of one record, and the way to delete it.
 *
 * Kept together because they are the two halves of the same right, and because
 * the sensible order is obvious when they sit side by side: take your copy,
 * then delete.
 *
 * ## Two things this screen refuses to be vague about
 *
 * - **Only the record's subject can delete it.** A manager or a helper is told
 *   so by the server, and the message says whose decision it is rather than
 *   showing a button that fails.
 * - **Deletion is not instant everywhere.** Copies on other people's phones go
 *   when those phones next connect. Saying that is the difference between an
 *   honest report and a claim nobody can make good on.
 */
export default function RecordExportScreen(): React.JSX.Element {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const vault = useVaultSnapshot();
  const removeParent = useVaultStore((state) => state.removeParent);
  const parent = id ? selectParent(vault, id) : undefined;

  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [busy, setBusy] = useState(false);

  if (!parent) {
    return (
      <Screen testID="record-export-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Profile not found"
          message="It may have been deleted already."
          actionLabel="Back to home"
          onAction={() => router.replace('/')}
        />
      </Screen>
    );
  }

  const handleExport = (): void => {
    setBusy(true);
    setError(null);

    void accountService.requestDataExport().then(
      (result) => {
        setBusy(false);
        setNotice(
          result.outcome === 'no_backend'
            ? 'This build has no server, so everything for this person is already only on this phone.'
            : `Assembled ${formatDateTime(result.exportedAt)}. Saving it to a file from the app is not built yet, so nothing has been written to this phone.`,
        );
      },
      () => {
        setBusy(false);
        setError('The copy could not be assembled just now. Nothing has changed.');
      },
    );
  };

  const handleDelete = (): void => {
    setConfirmVisible(false);
    setBusy(true);
    setError(null);

    void accountService.deleteRecord(parent.id, typedName).then(
      (result) => {
        setBusy(false);
        removeParent(parent.id);
        setTypedName('');

        if (result.outcome === 'local_only') {
          router.replace('/');
          return;
        }

        router.replace('/');
      },
      () => {
        setBusy(false);
        setTypedName('');
        setError(
          'This record was not deleted. Only the person whose record it is can delete it — a helper, even one who manages it, cannot.',
        );
      },
    );
  };

  return (
    <Screen testID="record-export">
      <SectionHeader title={`${parent.fullName}’s record`} />

      {notice === null ? null : (
        <Callout tone="info" message={notice} testID="record-export-notice" />
      )}
      {error === null ? null : (
        <Callout tone="warning" message={error} testID="record-export-error" />
      )}

      <Card testID="record-export-card">
        <Text variant="bodyStrong">Take a copy</Text>
        <Text variant="callout" tone="secondary">
          Everything held for this person as it stands now: documents, summaries and the
          corrections people made to them, what has been agreed to, and who did what.
        </Text>
        <Button
          label="Assemble a copy"
          variant="secondary"
          onPress={handleExport}
          disabled={busy}
          testID="record-export-button"
        />
      </Card>

      <Card testID="record-delete-card">
        <Text variant="bodyStrong">Delete this record</Text>
        <Text variant="callout" tone="secondary">
          Removes the documents, the pages, the summaries and everything else held for this person,
          and takes everybody’s access with it. This cannot be undone.
        </Text>
        <Text variant="caption" tone="muted">
          Copies already on other people’s phones are removed the next time each phone connects.
          {isBackendEnabled()
            ? ''
            : ' This build has no server, so this only removes the copy on this phone.'}
        </Text>
        <Button
          label="Delete this record"
          variant="danger"
          onPress={() => {
            setTypedName('');
            setConfirmVisible(true);
          }}
          disabled={busy}
          testID="record-delete-button"
        />
      </Card>

      <ConfirmDialog
        visible={confirmVisible}
        title="Delete this record?"
        message={`Type “${parent.fullName}” to confirm. Everything held for this person is removed, and nobody can get it back.`}
        confirmLabel="Delete it"
        destructive
        /*
          The name, typed. Not a checkbox: this is the one irreversible action
          in the app, and a mis-tap is the likeliest way somebody loses a
          parent's entire medical history.
        */
        confirmDisabled={typedName.trim().toLowerCase() !== parent.fullName.trim().toLowerCase()}
        onConfirm={handleDelete}
        onCancel={() => {
          setConfirmVisible(false);
          setTypedName('');
        }}
        testID="record-delete-confirm"
      >
        <TextField
          label="Type the name"
          value={typedName}
          onChangeText={setTypedName}
          testID="record-delete-name"
        />
      </ConfirmDialog>
    </Screen>
  );
}
