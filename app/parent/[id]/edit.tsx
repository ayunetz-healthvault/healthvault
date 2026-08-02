import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { Button, ConfirmDialog, EmptyState, Screen, Text } from '@/components';
import { ParentForm } from '@/features/parents/ParentForm';
import { selectParent, useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';
import type { ParentDraft } from '@/types/domain';
import { pluralise } from '@/utils/format';

export default function EditParentScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [deleteVisible, setDeleteVisible] = useState(false);

  const vault = useVaultStore((state) => ({
    parents: state.parents,
    documents: state.documents,
    summaries: state.summaries,
    followUps: state.followUps,
  }));
  const updateParent = useVaultStore((state) => state.updateParent);
  const removeParent = useVaultStore((state) => state.removeParent);

  const parent = id ? selectParent(vault, id) : undefined;

  if (!parent) {
    return (
      <Screen testID="parent-edit-missing">
        <EmptyState
          icon="alert-circle-outline"
          title="Profile not found"
          message="This profile may have been deleted."
          actionLabel="Go back"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  const documentCount = vault.documents.filter((doc) => doc.parentId === parent.id).length;
  const followUpCount = vault.followUps.filter((item) => item.parentId === parent.id).length;

  const initial: ParentDraft = {
    fullName: parent.fullName,
    relationship: parent.relationship,
    dateOfBirth: parent.dateOfBirth,
    bloodGroup: parent.bloodGroup,
    city: parent.city,
    phone: parent.phone,
    conditions: parent.conditions,
    allergies: parent.allergies,
    primaryDoctor: parent.primaryDoctor,
    notes: parent.notes,
    avatarColor: parent.avatarColor,
  };

  const handleDelete = (): void => {
    setDeleteVisible(false);
    removeParent(parent.id);
    router.replace('/(tabs)');
  };

  return (
    <Screen testID="parent-edit">
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Edit profile
      </Text>

      <ParentForm
        initial={initial}
        submitLabel="Save changes"
        onSubmit={(draft) => {
          updateParent(parent.id, draft);
          router.back();
        }}
        onCancel={() => router.back()}
        testID="parent-edit-form"
      />

      <Button
        label="Delete this profile"
        variant="danger"
        icon="trash-outline"
        onPress={() => setDeleteVisible(true)}
        style={styles.delete}
        testID="parent-edit-delete"
      />

      <ConfirmDialog
        visible={deleteVisible}
        title={`Delete ${parent.fullName}?`}
        message={`This also deletes ${pluralise(documentCount, 'document')} and ${pluralise(followUpCount, 'follow-up')} belonging to them. This cannot be undone.`}
        confirmLabel="Delete permanently"
        destructive
        onConfirm={handleDelete}
        onCancel={() => setDeleteVisible(false)}
        testID="parent-delete-dialog"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  delete: { marginTop: spacing.xxxl },
  heading: { marginBottom: spacing.xxl, marginTop: spacing.lg },
});
