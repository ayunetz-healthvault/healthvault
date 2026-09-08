import { useCallback, useState } from 'react';
import { StyleSheet } from 'react-native';

import {
  Badge,
  Button,
  Callout,
  Card,
  ChipSelect,
  ConfirmDialog,
  EmptyState,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { accessService, REVOCATION_LIMITS } from '@/services/access/accessService';
import { useExperience } from '@/services/experience';
import { useSessionStore } from '@/state/sessionStore';
import { selectParent, useVaultSnapshot } from '@/state/vaultStore';
import { spacing } from '@/theme';
import { canManageAccess, ROLE_DESCRIPTIONS, type Grant, type GrantRole } from '@/types/access';
import { formatDate } from '@/utils/date';

/**
 * Who can see this parent's record, and how to stop them.
 *
 * The reference shows a single "Share my record" checkbox. That control cannot
 * ship in this form: sharing a health record is a grant to a *named account*
 * with a stated scope, and a checkbox with no grantee behind it would tell
 * somebody their record was private when the question of who could read it had
 * never been asked.
 *
 * So this names people, states in plain words what each one may do, and says
 * exactly what withdrawing access achieves — including what it cannot reach.
 */

type Shareable = Exclude<GrantRole, 'self'>;

const SHAREABLE_ROLES: { value: Shareable; label: string }[] = [
  { value: 'viewer', label: 'Can only look' },
  { value: 'contributor', label: 'Can help' },
  { value: 'manager', label: 'Looks after it' },
];

export default function ParentFamilyScreen(): React.JSX.Element {
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();
  const accountId = useSessionStore((state) => state.user?.id ?? null);
  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);

  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [role, setRole] = useState<Shareable>('viewer');
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<Grant | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (record === undefined) return;
    try {
      setGrants(await accessService.grantsFor(record.id));
    } catch {
      // Offline, most likely. Showing nothing is better than showing a list
      // that might be out of date about who can read somebody's health record.
      setGrants(null);
      setNotice('Could not check who has access just now. Try again when you are online.');
    }
  }, [record]);

  const handleInvite = async (): Promise<void> => {
    if (record === undefined) return;
    setBusy(true);
    setNotice(null);
    try {
      const issued = await accessService.invite(record.id, role);
      setIssuedToken(issued.token);
      await load();
    } catch {
      setNotice('The invitation could not be created. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (): Promise<void> => {
    if (record === undefined || pendingRevoke === null) return;
    setBusy(true);
    try {
      await accessService.revoke(record.id, pendingRevoke.accountId);
      setNotice('Access removed.');
      await load();
    } catch {
      setNotice('Access could not be removed just now. Try again when you are online.');
    } finally {
      setPendingRevoke(null);
      setBusy(false);
    }
  };

  if (record === undefined) {
    return (
      <Screen testID="me-family-empty">
        <EmptyState
          icon="people-outline"
          title="Your record is not set up yet"
          message="Once your own health record exists, this is where you decide who may see it."
          testID="me-family-empty-state"
        />
      </Screen>
    );
  }

  const helpers = (grants ?? []).filter(
    (grant) => grant.status === 'active' && grant.accountId !== accountId,
  );
  const mine = (grants ?? []).find((grant) => grant.accountId === accountId);
  const mayShare = mine !== undefined && canManageAccess(mine.role);

  return (
    <Screen testID="me-family" onRefresh={() => void load()} refreshing={false}>
      <SectionHeader
        title="My family helper"
        subtitle="Who can see your record"
        actionLabel="Check now"
        onAction={() => void load()}
        testID="me-family-header"
      />

      {notice === null ? null : <Callout tone="warning" message={notice} testID="me-family-notice" />}

      {grants === null ? (
        <Card tone="quiet" style={styles.card} testID="me-family-unknown">
          <Text variant="bodyStrong">Not checked yet</Text>
          <Text variant="callout" tone="secondary">
            Tap “Check now” to see who currently has access. This always comes from the server, so it
            is never out of date on this screen.
          </Text>
        </Card>
      ) : helpers.length === 0 ? (
        <Card tone="quiet" style={styles.card} testID="me-family-nobody">
          <Text variant="heading">Nobody else has access</Text>
          <Text variant="callout" tone="secondary">
            Your record is only on your own account. No helper can open it.
          </Text>
        </Card>
      ) : (
        helpers.map((grant) => (
          <Card key={grant.accountId} style={styles.card} testID={`me-family-helper-${grant.accountId}`}>
            <Text variant="subheading">{grant.accountId}</Text>
            <Badge label={ROLE_DESCRIPTIONS[grant.role].label} tone="brand" />
            <Text variant="callout" tone="secondary">
              {ROLE_DESCRIPTIONS[grant.role].detail}
            </Text>
            <Text variant="caption" tone="muted">
              Access given {formatDate(grant.grantedAt)}
            </Text>
            {mayShare ? (
              <Button
                label="Remove their access"
                variant="secondary"
                size="medium"
                onPress={() => setPendingRevoke(grant)}
                testID={`me-family-revoke-${grant.accountId}`}
              />
            ) : null}
          </Card>
        ))
      )}

      {mayShare ? (
        <>
          <SectionHeader title="Invite someone" testID="me-family-invite-header" />
          <ChipSelect
            label="What should they be able to do?"
            options={SHAREABLE_ROLES}
            value={role}
            onChange={setRole}
            testID="me-family-role"
          />
          <Text variant="callout" tone="secondary">
            {ROLE_DESCRIPTIONS[role].detail}
          </Text>
          <Button
            label="Create an invitation"
            onPress={() => void handleInvite()}
            loading={busy}
            style={styles.action}
            testID="me-family-invite"
          />
        </>
      ) : null}

      {issuedToken === null ? null : (
        <Card tone="appointment" style={styles.card} testID="me-family-token">
          <Text variant="bodyStrong">Give this to the person you are inviting</Text>
          {/*
            Shown once. The server keeps only a hash, so this is the single
            moment it exists in readable form — and the app deliberately does
            not send it anywhere on the user's behalf.
          */}
          <Text variant="callout" selectable>
            {issuedToken}
          </Text>
          <Text variant="caption" tone="secondary">
            It works once, expires in seven days, and does nothing on its own — they need their own
            account to use it. You will not be able to see it again after you leave this screen.
          </Text>
        </Card>
      )}

      <ConfirmDialog
        visible={pendingRevoke !== null}
        title="Remove their access?"
        message={REVOCATION_LIMITS}
        confirmLabel="Remove access"
        destructive
        onConfirm={() => void handleRevoke()}
        onCancel={() => setPendingRevoke(null)}
        testID="me-family-revoke-confirm"
      />

      <SectionHeader title="My profile" testID="me-family-profile-header" />
      <Card style={styles.card} testID="me-family-profile">
        <Text variant="bodyStrong">{record.fullName}</Text>
        <Text variant="callout" tone="secondary">
          This is your own record. Everything added to it shows who added it and when.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  card: { gap: spacing.sm, marginBottom: spacing.md },
});
