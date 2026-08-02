import { StyleSheet, View } from 'react-native';

import { Text } from './Text';

import { radius } from '@/theme';
import { avatarColorFor, initialsOf } from '@/utils/format';

export interface AvatarProps {
  name: string;
  color?: string | undefined;
  size?: number | undefined;
  testID?: string | undefined;
}

/** Initials chip. Never renders a photo — a face is not ours to store. */
export function Avatar({ name, color, size = 56, testID }: AvatarProps): React.JSX.Element {
  const background = color ?? avatarColorFor(name);
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={name}
      style={[
        styles.avatar,
        { backgroundColor: background, height: size, width: size, borderRadius: radius.pill },
      ]}
    >
      <Text
        tone="inverse"
        style={{ fontSize: size * 0.36, lineHeight: size * 0.46, fontWeight: '700' }}
      >
        {initialsOf(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center' },
});
