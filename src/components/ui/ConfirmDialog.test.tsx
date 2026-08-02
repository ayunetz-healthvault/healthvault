import { fireEvent, render, screen } from '@testing-library/react-native';

import { ConfirmDialog } from './ConfirmDialog';
import { Text } from './Text';

const baseProps = {
  visible: true,
  title: 'Add to your calendar?',
  message: 'Ayunetz will create this event on your calendar.',
  confirmLabel: 'Add event',
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
  testID: 'dialog',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ConfirmDialog', () => {
  it('shows the title and message when visible', async () => {
    await render(<ConfirmDialog {...baseProps} />);

    expect(screen.getByText('Add to your calendar?')).toBeTruthy();
    expect(screen.getByText('Ayunetz will create this event on your calendar.')).toBeTruthy();
  });

  it('renders nothing when not visible', async () => {
    await render(<ConfirmDialog {...baseProps} visible={false} />);

    expect(screen.queryByText('Add to your calendar?')).toBeNull();
  });

  it('calls onConfirm only when the confirm button is pressed', async () => {
    await render(<ConfirmDialog {...baseProps} />);

    await fireEvent.press(screen.getByTestId('dialog-confirm'));

    expect(baseProps.onConfirm).toHaveBeenCalledTimes(1);
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it('calls onCancel from the cancel button', async () => {
    await render(<ConfirmDialog {...baseProps} />);

    await fireEvent.press(screen.getByTestId('dialog-cancel'));

    expect(baseProps.onCancel).toHaveBeenCalledTimes(1);
    expect(baseProps.onConfirm).not.toHaveBeenCalled();
  });

  it('blocks confirmation when confirmDisabled is set', async () => {
    await render(<ConfirmDialog {...baseProps} confirmDisabled />);

    await fireEvent.press(screen.getByTestId('dialog-confirm'));

    expect(baseProps.onConfirm).not.toHaveBeenCalled();
  });

  it('blocks both actions while loading', async () => {
    await render(<ConfirmDialog {...baseProps} loading />);

    await fireEvent.press(screen.getByTestId('dialog-confirm'));
    await fireEvent.press(screen.getByTestId('dialog-cancel'));

    expect(baseProps.onConfirm).not.toHaveBeenCalled();
    expect(baseProps.onCancel).not.toHaveBeenCalled();
  });

  it('renders the preview passed as children — this is what the user is confirming', async () => {
    await render(
      <ConfirmDialog {...baseProps}>
        <Text>Review diabetes panel — Lakshmi Iyer</Text>
      </ConfirmDialog>,
    );

    expect(screen.getByText('Review diabetes panel — Lakshmi Iyer')).toBeTruthy();
  });

  it('uses the danger variant for destructive confirmations', async () => {
    await render(<ConfirmDialog {...baseProps} confirmLabel="Delete permanently" destructive />);

    expect(screen.getByText('Delete permanently')).toBeTruthy();
  });
});
