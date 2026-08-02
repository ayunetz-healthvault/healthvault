import { useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';

import { Screen, Text } from '@/components';
import { ParentForm, emptyParentDraft } from '@/features/parents/ParentForm';
import { useVaultStore } from '@/state/vaultStore';
import { spacing } from '@/theme';

export default function NewParentScreen(): React.JSX.Element {
  const router = useRouter();
  const addParent = useVaultStore((state) => state.addParent);

  return (
    <Screen testID="parent-new">
      <Text variant="title" accessibilityRole="header" style={styles.heading}>
        Add a parent
      </Text>
      <Text variant="callout" tone="secondary" style={styles.intro}>
        Only the name is needed to start. You can fill in the rest whenever you have it.
      </Text>

      <ParentForm
        initial={emptyParentDraft()}
        submitLabel="Save profile"
        onSubmit={(draft) => {
          const parent = addParent(draft);
          router.replace(`/parent/${parent.id}`);
        }}
        onCancel={() => router.back()}
        testID="parent-new-form"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { marginBottom: spacing.sm, marginTop: spacing.lg },
  intro: { marginBottom: spacing.xxl },
});
