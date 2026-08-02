import { fireEvent, render, screen } from '@testing-library/react-native';

import { Button } from './Button';

import { touchTarget } from '@/theme';

describe('Button', () => {
  it('renders the label and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save profile" onPress={onPress} testID="save" />);

    await fireEvent.press(screen.getByTestId('save'));

    expect(screen.getByText('Save profile')).toBeTruthy();
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not fire when disabled', async () => {
    const onPress = jest.fn();
    await render(<Button label="Save" onPress={onPress} disabled testID="save" />);

    await fireEvent.press(screen.getByTestId('save'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('save')).toBeDisabled();
  });

  it('does not fire while loading, and hides the label for a spinner', async () => {
    const onPress = jest.fn();
    await render(<Button label="Uploading" onPress={onPress} loading testID="upload" />);

    await fireEvent.press(screen.getByTestId('upload'));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.queryByText('Uploading')).toBeNull();
  });

  it('exposes a busy state to screen readers while loading', async () => {
    await render(<Button label="Uploading" onPress={jest.fn()} loading testID="upload" />);

    expect(screen.getByTestId('upload').props.accessibilityState).toMatchObject({ busy: true });
  });

  it('defaults its accessibility label to the visible label', async () => {
    await render(<Button label="Delete document" onPress={jest.fn()} />);

    expect(screen.getByLabelText('Delete document')).toBeTruthy();
  });

  it('honours an explicit accessibility label and hint', async () => {
    await render(
      <Button
        label="Add"
        onPress={jest.fn()}
        accessibilityLabel="Add a parent profile"
        accessibilityHint="Opens the new parent form"
        testID="add"
      />,
    );

    expect(screen.getByLabelText('Add a parent profile')).toBeTruthy();
    expect(screen.getByTestId('add').props.accessibilityHint).toBe('Opens the new parent form');
  });

  it.each([
    ['large', touchTarget.comfortable],
    ['medium', touchTarget.min],
  ] as const)('meets the %s touch target of %ipt', async (size, expected) => {
    await render(<Button label="Tap" onPress={jest.fn()} size={size} testID="tap" />);

    const style = screen.getByTestId('tap').props.style as { minHeight?: number }[] | undefined;
    const flattened = Object.assign({}, ...(style ?? []).filter(Boolean));

    expect(flattened.minHeight).toBe(expected);
    // Never below the platform minimum, whatever the variant.
    expect(flattened.minHeight).toBeGreaterThanOrEqual(48);
  });
});
