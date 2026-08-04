import { render, screen } from '@testing-library/react-native';

import { SourceBadge } from './SourceBadge';

import type { SourceReference } from '@/types/domain';

const source = (page: number): SourceReference => ({ documentId: 'doc_1', page });

describe('SourceBadge', () => {
  it('names the page a value was read from', async () => {
    await render(<SourceBadge sources={[source(2)]} testID="badge" />);

    expect(screen.getByText('Page 2')).toBeTruthy();
  });

  it('lists several pages in order', async () => {
    await render(<SourceBadge sources={[source(3), source(1)]} />);

    expect(screen.getByText('Pages 1, 3')).toBeTruthy();
  });

  it('collapses repeated citations of the same page', async () => {
    await render(<SourceBadge sources={[source(2), source(2)]} />);

    expect(screen.getByText('Page 2')).toBeTruthy();
  });

  it('renders nothing when there is no source', async () => {
    // Every summary produced before the pipeline existed is in this state,
    // including the seeded demo data. Showing "unknown page" everywhere would
    // teach people to ignore the field.
    await render(<SourceBadge sources={undefined} testID="badge" />);

    expect(screen.queryByTestId('badge')).toBeNull();
  });

  it('renders nothing for an empty list', async () => {
    await render(<SourceBadge sources={[]} testID="badge" />);

    expect(screen.queryByTestId('badge')).toBeNull();
  });

  it('gives a screen reader the context the visual label omits', async () => {
    await render(<SourceBadge sources={[source(2)]} testID="badge" />);

    expect(screen.getByTestId('badge').props.accessibilityLabel).toBe(
      'Read from page 2 of this document',
    );
  });
});
