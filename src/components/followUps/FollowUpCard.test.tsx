import { fireEvent, render, screen } from '@testing-library/react-native';

import { FollowUpCard } from './FollowUpCard';

import type { FollowUp } from '@/types/domain';
import { isoToday } from '@/utils/date';

const followUp = (overrides: Partial<FollowUp> = {}): FollowUp => ({
  id: 'fup_1',
  parentId: 'par_1',
  title: 'Review diabetes panel',
  kind: 'doctor_visit',
  dueDate: isoToday(3),
  dueTime: '10:30',
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
  ...overrides,
});

describe('FollowUpCard', () => {
  it('shows the title, a relative due date and the time', async () => {
    await render(<FollowUpCard followUp={followUp()} onPress={jest.fn()} />);

    expect(screen.getByText('Review diabetes panel')).toBeTruthy();
    expect(screen.getByText('In 3 days at 10:30 am')).toBeTruthy();
  });

  it('shows the parent name when one is supplied', async () => {
    await render(
      <FollowUpCard followUp={followUp()} parentName="Lakshmi Iyer" onPress={jest.fn()} />,
    );

    expect(screen.getByText('Lakshmi Iyer')).toBeTruthy();
  });

  it('flags an overdue item with a text badge, not colour alone', async () => {
    await render(
      <FollowUpCard followUp={followUp({ dueDate: isoToday(-2) })} onPress={jest.fn()} />,
    );

    expect(screen.getByText('Overdue')).toBeTruthy();
  });

  it('does not call a completed item overdue, even when the date has passed', async () => {
    await render(
      <FollowUpCard
        followUp={followUp({ dueDate: isoToday(-10), status: 'completed' })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.queryByText('Overdue')).toBeNull();
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('marks items that are already on the calendar', async () => {
    await render(
      <FollowUpCard followUp={followUp({ calendarEventId: 'event-1' })} onPress={jest.fn()} />,
    );

    expect(screen.getByText('In calendar')).toBeTruthy();
  });

  it('omits the time when the follow-up has no fixed hour', async () => {
    await render(
      <FollowUpCard
        followUp={followUp({ dueTime: null, dueDate: isoToday(1) })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText('Tomorrow')).toBeTruthy();
  });

  it('builds an accessibility label covering who, what and when', async () => {
    await render(
      <FollowUpCard
        followUp={followUp({ dueDate: isoToday(-1) })}
        parentName="Lakshmi Iyer"
        onPress={jest.fn()}
        testID="card"
      />,
    );

    const label = screen.getByTestId('card').props.accessibilityLabel as string;
    expect(label).toContain('Review diabetes panel');
    expect(label).toContain('for Lakshmi Iyer');
    expect(label).toContain('Overdue');
  });

  it('is pressable', async () => {
    const onPress = jest.fn();
    await render(<FollowUpCard followUp={followUp()} onPress={onPress} testID="card" />);

    await fireEvent.press(screen.getByTestId('card'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
