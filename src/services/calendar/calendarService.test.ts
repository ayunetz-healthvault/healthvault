import * as Calendar from 'expo-calendar';

import { calendarService } from './calendarService';

import type { FollowUp, ParentProfile } from '@/types/domain';

const parent: ParentProfile = {
  id: 'par_1',
  fullName: 'Lakshmi Iyer',
  relationship: 'mother',
  dateOfBirth: '1955-04-18',
  bloodGroup: 'B+',
  city: 'Chennai',
  phone: '+91 98400 12345',
  conditions: [],
  allergies: [],
  primaryDoctor: 'Dr. Meera Krishnan',
  notes: '',
  avatarColor: '#0E7C66',
  createdAt: '2026-01-12T09:00:00.000Z',
  updatedAt: '2026-01-12T09:00:00.000Z',
};

const followUp: FollowUp = {
  id: 'fup_1',
  parentId: 'par_1',
  title: 'Review diabetes panel',
  kind: 'doctor_visit',
  dueDate: '2026-08-06',
  dueTime: '10:30',
  notes: 'Carry the July lab report.',
  status: 'scheduled',
  sourceDocumentId: 'doc_1',
  doctorCategory: 'endocrinologist',
  calendarEventId: null,
  createdAt: '2026-07-30T10:00:00.000Z',
  updatedAt: '2026-07-30T10:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildEventPreview', () => {
  it('names both the task and the parent in the title', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);
    expect(preview.title).toBe('Review diabetes panel — Lakshmi Iyer');
  });

  it('honours the follow-up time', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);
    expect(preview.startDate.getHours()).toBe(10);
    expect(preview.startDate.getMinutes()).toBe(30);
  });

  it('runs for an hour by default', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);
    const minutes = (preview.endDate.getTime() - preview.startDate.getTime()) / 60_000;
    expect(minutes).toBe(60);
  });

  it('reminds a day ahead, which survives a time difference', () => {
    expect(calendarService.buildEventPreview(followUp, parent).reminderMinutes).toBe(24 * 60);
  });

  it('carries the notes, the doctor and an attribution into the event body', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);
    expect(preview.notes).toContain('Carry the July lab report.');
    expect(preview.notes).toContain('Dr. Meera Krishnan');
    expect(preview.notes).toContain('Ayunetz');
  });

  it('copes with a missing parent', () => {
    const preview = calendarService.buildEventPreview(followUp, undefined);
    expect(preview.title).toContain('your parent');
    expect(preview.location).toBe('');
  });

  it('defaults an untimed follow-up to 09:00', () => {
    const preview = calendarService.buildEventPreview({ ...followUp, dueTime: null }, parent);
    expect(preview.startDate.getHours()).toBe(9);
  });
});

describe('addFollowUpToCalendar', () => {
  it('creates the event and reports which calendar it landed in', async () => {
    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result).toEqual({ status: 'created', eventId: 'event-1', calendarTitle: 'Personal' });
    expect(Calendar.createEventAsync).toHaveBeenCalledTimes(1);
  });

  it('writes the event in the parent’s time zone, not the caregiver’s', async () => {
    await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(Calendar.createEventAsync).toHaveBeenCalledWith(
      'cal-1',
      expect.objectContaining({ timeZone: 'Asia/Kolkata' }),
    );
  });

  it('writes nothing when calendar permission is refused', async () => {
    jest
      .mocked(Calendar.getCalendarPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied' } as never);
    jest
      .mocked(Calendar.requestCalendarPermissionsAsync)
      .mockResolvedValueOnce({ status: 'denied' } as never);

    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result).toEqual({ status: 'permission_denied' });
    expect(Calendar.createEventAsync).not.toHaveBeenCalled();
  });

  it('reports when no calendar can be written to', async () => {
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValueOnce([]);
    jest.mocked(Calendar.getDefaultCalendarAsync).mockResolvedValueOnce(null as never);

    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result.status).toBe('no_writable_calendar');
  });

  it('surfaces a creation failure rather than throwing', async () => {
    jest
      .mocked(Calendar.createEventAsync)
      .mockRejectedValueOnce(new Error('Calendar is read-only'));

    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result).toEqual({ status: 'failed', message: 'Calendar is read-only' });
  });
});

describe('getWritableCalendars', () => {
  it('excludes calendars that cannot be modified', async () => {
    jest.mocked(Calendar.getCalendarsAsync).mockResolvedValueOnce([
      { id: 'a', title: 'Personal', allowsModifications: true, source: { name: 'Local' } },
      { id: 'b', title: 'Holidays', allowsModifications: false, source: { name: 'Google' } },
    ] as never);

    const calendars = await calendarService.getWritableCalendars();

    expect(calendars).toEqual([{ id: 'a', title: 'Personal', sourceName: 'Local' }]);
  });
});

describe('removeEvent', () => {
  it('reports success when the event is deleted', async () => {
    await expect(calendarService.removeEvent('event-1')).resolves.toBe(true);
  });

  it('reports failure without throwing when deletion fails', async () => {
    jest.mocked(Calendar.deleteEventAsync).mockRejectedValueOnce(new Error('gone'));
    await expect(calendarService.removeEvent('event-1')).resolves.toBe(false);
  });
});
