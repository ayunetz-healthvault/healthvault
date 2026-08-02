import { fireEvent, render, screen } from '@testing-library/react-native';

import { ParentCard } from './ParentCard';

import type { ParentSummaryStats } from '@/state/vaultStore';
import type { FollowUp, ParentProfile } from '@/types/domain';
import { isoToday } from '@/utils/date';

const parent: ParentProfile = {
  id: 'par_1',
  fullName: 'Lakshmi Iyer',
  relationship: 'mother',
  dateOfBirth: '1955-04-18',
  bloodGroup: 'B+',
  city: 'Chennai',
  phone: '+91 98400 12345',
  conditions: ['Type 2 diabetes'],
  allergies: [],
  primaryDoctor: 'Dr. Meera Krishnan',
  notes: '',
  avatarColor: '#0E7C66',
  createdAt: '2026-01-12T09:00:00.000Z',
  updatedAt: '2026-01-12T09:00:00.000Z',
};

const nextFollowUp: FollowUp = {
  id: 'fup_1',
  parentId: 'par_1',
  title: 'Review diabetes panel',
  kind: 'doctor_visit',
  dueDate: isoToday(2),
  dueTime: '10:30',
  notes: '',
  status: 'scheduled',
  sourceDocumentId: null,
  doctorCategory: null,
  calendarEventId: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
};

const stats = (overrides: Partial<ParentSummaryStats> = {}): ParentSummaryStats => ({
  documentCount: 4,
  upcomingCount: 3,
  overdueCount: 0,
  nextFollowUp,
  ...overrides,
});

describe('ParentCard', () => {
  it('shows the name, relationship, age and city', async () => {
    await render(<ParentCard parent={parent} stats={stats()} onPress={jest.fn()} />);

    expect(screen.getByText('Lakshmi Iyer')).toBeTruthy();
    expect(screen.getByText(/Mother · \d+ years · Chennai/)).toBeTruthy();
  });

  it('shows initials rather than a photo', async () => {
    await render(<ParentCard parent={parent} stats={stats()} onPress={jest.fn()} />);

    expect(screen.getByText('LI')).toBeTruthy();
  });

  it('leads with the next follow-up', async () => {
    await render(<ParentCard parent={parent} stats={stats()} onPress={jest.fn()} />);

    expect(screen.getByText('In 2 days — Review diabetes panel')).toBeTruthy();
  });

  it('says so plainly when nothing is scheduled', async () => {
    await render(
      <ParentCard
        parent={parent}
        stats={stats({ nextFollowUp: undefined, upcomingCount: 0 })}
        onPress={jest.fn()}
      />,
    );

    expect(screen.getByText('Nothing scheduled right now')).toBeTruthy();
  });

  it('surfaces an overdue count as a labelled badge', async () => {
    await render(
      <ParentCard parent={parent} stats={stats({ overdueCount: 2 })} onPress={jest.fn()} />,
    );

    expect(screen.getByText('2 items overdue')).toBeTruthy();
  });

  it('hides the overdue badge when there is nothing overdue', async () => {
    await render(<ParentCard parent={parent} stats={stats()} onPress={jest.fn()} />);

    expect(screen.queryByText(/overdue/)).toBeNull();
  });

  it('counts documents and upcoming follow-ups', async () => {
    await render(<ParentCard parent={parent} stats={stats()} onPress={jest.fn()} />);

    expect(screen.getByText('4 documents')).toBeTruthy();
    expect(screen.getByText('3 follow-ups upcoming')).toBeTruthy();
  });

  it('packs the urgent information into its accessibility label', async () => {
    await render(
      <ParentCard
        parent={parent}
        stats={stats({ overdueCount: 1 })}
        onPress={jest.fn()}
        testID="card"
      />,
    );

    const label = screen.getByTestId('card').props.accessibilityLabel as string;
    expect(label).toContain('Lakshmi Iyer');
    expect(label).toContain('1 overdue follow-up');
    expect(label).toContain('Next: Review diabetes panel');
  });

  it('is pressable', async () => {
    const onPress = jest.fn();
    await render(<ParentCard parent={parent} stats={stats()} onPress={onPress} testID="card" />);

    await fireEvent.press(screen.getByTestId('card'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
