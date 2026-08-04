import { render, screen } from '@testing-library/react-native';

import { FindingRow } from './FindingRow';

import type { SummaryFinding } from '@/types/domain';

const finding = (overrides: Partial<SummaryFinding> = {}): SummaryFinding => ({
  id: 'fnd_1',
  label: 'HbA1c (3-month average sugar)',
  value: '8.1 %',
  referenceRange: 'Below 7.0 % for people with diabetes',
  severity: 'attention',
  plainLanguage: 'Average blood sugar has been above target for the past three months.',
  ...overrides,
});

describe('FindingRow', () => {
  it('shows the label, the value and the plain-language reading', async () => {
    await render(<FindingRow finding={finding()} />);

    expect(screen.getByText('HbA1c (3-month average sugar)')).toBeTruthy();
    expect(screen.getByText('8.1 %')).toBeTruthy();
    expect(
      screen.getByText('Average blood sugar has been above target for the past three months.'),
    ).toBeTruthy();
  });

  it('shows the reference range so the number has context', async () => {
    await render(<FindingRow finding={finding()} />);

    expect(screen.getByText('Normal range: Below 7.0 % for people with diabetes')).toBeTruthy();
  });

  it('omits the range line when the document gives none', async () => {
    await render(<FindingRow finding={finding({ referenceRange: null })} />);

    expect(screen.queryByText(/Normal range/)).toBeNull();
  });

  it.each([
    ['normal', 'In range'],
    ['watch', 'Keep an eye on it'],
    ['attention', 'Discuss with the doctor'],
  ] as const)(
    'carries a written label for %p severity, not colour alone',
    async (severity, expected) => {
      await render(<FindingRow finding={finding({ severity })} />);

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );

  it('reads the whole finding out as one accessible unit', async () => {
    await render(<FindingRow finding={finding()} testID="row" />);

    const label = screen.getByTestId('row').props.accessibilityLabel as string;
    expect(label).toContain('HbA1c');
    expect(label).toContain('8.1 %');
    expect(label).toContain('Discuss with the doctor');
  });
  it('shows the page a value was read from, so it can be checked', async () => {
    await render(
      <FindingRow
        finding={finding({ sources: [{ documentId: 'doc_1', page: 2 }] })}
        testID="finding"
      />,
    );

    expect(screen.getByText('Page 2')).toBeTruthy();
  });

  it('shows no source badge for a summary written before the pipeline existed', async () => {
    await render(<FindingRow finding={finding()} testID="finding" />);

    expect(screen.queryByTestId('finding-source')).toBeNull();
  });
});
