import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

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
  /**
   * Also inverted by KOO-12. "Review diabetes panel — Lakshmi Iyer" names a
   * person and their condition in a string that appears on a lock screen.
   */
  it('keeps the task title out of the event, because it can name a condition', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);

    expect(preview.title).not.toContain('diabetes');
    expect(preview.title).toBe('Appointment');
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

  /**
   * These three used to assert the opposite — that the parent's full name went
   * in the title and their doctor and the follow-up's notes went in the body.
   * That was wrong, and KOO-12 says so: a calendar event shows on a lock
   * screen, syncs wherever the user's calendar syncs, and is visible to anybody
   * they share a calendar with. A doctor's name is a specialty and a specialty
   * is close enough to a diagnosis.
   */
  it('writes almost nothing by default', () => {
    const preview = calendarService.buildEventPreview(followUp, parent);

    expect(preview.title).toBe('Appointment');
    expect(preview.notes).toContain('Ayunetz');
    expect(preview.location).toBe('');
  });

  it('never carries the record into the event, at any detail level', () => {
    for (const detail of ['minimal', 'standard'] as const) {
      const preview = calendarService.buildEventPreview(followUp, parent, detail);
      const written = `${preview.title}|${preview.notes}|${preview.location}`;

      // The doctor, the follow-up's own notes, and the parent's full name.
      expect(written).not.toContain('Meera Krishnan');
      expect(written).not.toContain('Carry the July lab report');
      expect(written).not.toContain(parent.fullName);
    }
  });

  it('adds only a first name and the kind of appointment at the higher level', () => {
    const preview = calendarService.buildEventPreview(followUp, parent, 'standard');

    expect(preview.title).toContain(parent.fullName.split(' ')[0] as string);
    expect(preview.title).not.toContain(parent.fullName);
  });

  it('copes with a missing parent', () => {
    const preview = calendarService.buildEventPreview(followUp, undefined);

    expect(preview.title).toBe('Appointment');
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

describe('platforms with no calendar', () => {
  /**
   * The browser preview is the case that bit us. `expo-calendar`'s permission
   * request never settles on web — it neither resolves nor rejects — so the
   * confirmation dialog span forever with no error and no way out but Cancel.
   */
  const onWeb = (): void => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
  };

  const onPhone = (): void => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  };

  afterEach(onPhone);

  it('reports itself unavailable rather than calling the device', async () => {
    onWeb();

    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result.status).toBe('unavailable');
    // The call that hangs is never reached.
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('resolves rather than hanging, and does so promptly', async () => {
    onWeb();

    // A real assertion about the bug: this used to never settle at all.
    await expect(
      Promise.race([
        calendarService.addFollowUpToCalendar(followUp, parent),
        new Promise((_r, reject) => setTimeout(() => reject(new Error('hung')), 1_000)),
      ]),
    ).resolves.toMatchObject({ status: 'unavailable' });
  });

  it('treats permission as denied without calling the device', async () => {
    onWeb();

    await expect(calendarService.getPermission()).resolves.toBe('denied');
    await expect(calendarService.requestPermission()).resolves.toBe('denied');
    expect(Calendar.requestCalendarPermissionsAsync).not.toHaveBeenCalled();
  });

  it('says a calendar is available on a phone', () => {
    onPhone();

    expect(calendarService.isAvailable()).toBe(true);
  });
});

describe('a device call that never answers', () => {
  it('does not strand the caller when looking up permission throws', async () => {
    jest
      .mocked(Calendar.getCalendarPermissionsAsync)
      .mockRejectedValueOnce(new Error('calendar provider crashed'));
    jest
      .mocked(Calendar.requestCalendarPermissionsAsync)
      .mockRejectedValueOnce(new Error('calendar provider crashed'));

    // Previously unguarded: only `createEventAsync` was inside a try/catch, so
    // a throw here escaped as an unhandled rejection and the spinner stayed up.
    await expect(calendarService.addFollowUpToCalendar(followUp, parent)).resolves.toMatchObject({
      status: 'permission_denied',
    });
  });

  it('does not strand the caller when finding a calendar throws', async () => {
    jest
      .mocked(Calendar.getCalendarPermissionsAsync)
      .mockResolvedValueOnce({ status: 'granted' } as never);
    jest
      .mocked(Calendar.getCalendarsAsync)
      .mockRejectedValueOnce(new Error('no calendar provider'));

    const result = await calendarService.addFollowUpToCalendar(followUp, parent);

    expect(result.status).toBe('failed');
  });
});
