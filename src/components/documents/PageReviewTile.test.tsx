import { fireEvent, render, screen } from '@testing-library/react-native';

import { PageReviewTile } from './PageReviewTile';

import type { DocumentPage } from '@/types/domain';

const page = (overrides: Partial<DocumentPage> = {}): DocumentPage => ({
  id: 'pag_1',
  uri: 'file:///cache/page-1.jpg',
  kind: 'image',
  source: 'scan',
  fileName: 'diabetes-panel-p1.jpg',
  sizeBytes: 842_000,
  width: 1240,
  height: 1754,
  capturedAt: '2026-07-30T10:00:00.000Z',
  ...overrides,
});

const handlers = () => ({
  onMoveUp: jest.fn(),
  onMoveDown: jest.fn(),
  onRetake: jest.fn(),
  onRemove: jest.fn(),
});

describe('PageReviewTile', () => {
  it('shows its position in the document', async () => {
    await render(
      <PageReviewTile page={page()} index={1} total={3} {...handlers()} testID="tile" />,
    );

    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  });

  it('describes where the page came from and how big it is', async () => {
    await render(
      <PageReviewTile
        page={page({ source: 'gallery' })}
        index={0}
        total={1}
        {...handlers()}
        testID="tile"
      />,
    );

    expect(screen.getByText('From gallery · 822 KB')).toBeTruthy();
  });

  it('fires each of the four actions', async () => {
    const actions = handlers();
    await render(<PageReviewTile page={page()} index={1} total={3} {...actions} testID="tile" />);

    await fireEvent.press(screen.getByTestId('tile-up'));
    await fireEvent.press(screen.getByTestId('tile-down'));
    await fireEvent.press(screen.getByTestId('tile-retake'));
    await fireEvent.press(screen.getByTestId('tile-remove'));

    expect(actions.onMoveUp).toHaveBeenCalledTimes(1);
    expect(actions.onMoveDown).toHaveBeenCalledTimes(1);
    expect(actions.onRetake).toHaveBeenCalledTimes(1);
    expect(actions.onRemove).toHaveBeenCalledTimes(1);
  });

  it('disables "move up" on the first page', async () => {
    const actions = handlers();
    await render(<PageReviewTile page={page()} index={0} total={3} {...actions} testID="tile" />);

    await fireEvent.press(screen.getByTestId('tile-up'));

    expect(actions.onMoveUp).not.toHaveBeenCalled();
    expect(screen.getByTestId('tile-up')).toBeDisabled();
  });

  it('disables "move down" on the last page', async () => {
    const actions = handlers();
    await render(<PageReviewTile page={page()} index={2} total={3} {...actions} testID="tile" />);

    await fireEvent.press(screen.getByTestId('tile-down'));

    expect(actions.onMoveDown).not.toHaveBeenCalled();
    expect(screen.getByTestId('tile-down')).toBeDisabled();
  });

  it('leaves both enabled for a middle page', async () => {
    await render(
      <PageReviewTile page={page()} index={1} total={3} {...handlers()} testID="tile" />,
    );

    expect(screen.getByTestId('tile-up')).not.toBeDisabled();
    expect(screen.getByTestId('tile-down')).not.toBeDisabled();
  });

  it('labels each action with the page it applies to', async () => {
    await render(
      <PageReviewTile page={page()} index={1} total={3} {...handlers()} testID="tile" />,
    );

    expect(screen.getByLabelText('Move Page 2 of 3 up')).toBeTruthy();
    expect(screen.getByLabelText('Remove Page 2 of 3')).toBeTruthy();
  });

  it('shows a PDF placeholder instead of an image preview', async () => {
    await render(
      <PageReviewTile
        page={page({ kind: 'pdf', fileName: 'report.pdf' })}
        index={0}
        total={1}
        {...handlers()}
        testID="tile"
      />,
    );

    expect(screen.getByText('PDF')).toBeTruthy();
  });
});
