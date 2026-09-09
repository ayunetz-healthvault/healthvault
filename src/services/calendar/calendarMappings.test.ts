import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  createCalendarMappings,
  DEFAULT_CALENDAR_DETAIL,
  describeCalendarDetail,
} from './calendarMappings';

import { destroyVaultKey } from '@/services/storage/vaultCrypto';

/**
 * Which calendar event belongs to which follow-up, on *this* device.
 *
 * This used to be a field on the follow-up itself, which is part of the shared
 * record — so a caregiver in Berlin adding a visit to her calendar made it look
 * already added to her brother in Chennai, who then had no reminder. And if he
 * added it anyway, his event id overwrote hers, so cancelling the visit deleted
 * nothing on her phone. Both failures are tested below.
 */

const BERLIN = 'acc_sister';
const CHENNAI = 'acc_brother';

beforeEach(async () => {
  await AsyncStorage.clear();
  await destroyVaultKey(BERLIN);
  await destroyVaultKey(CHENNAI);
});

describe('per-device mappings', () => {
  it('remembers the event this device wrote', async () => {
    const mappings = createCalendarMappings(BERLIN);
    await mappings.remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-1',
      title: 'Appointment',
    });

    expect(await mappings.find('fup_1')).toMatchObject({ eventId: 'event-1' });
  });

  /** The first failure: one person's calendar entry hiding the button from another. */
  it('does not make one account’s event look like another’s', async () => {
    await createCalendarMappings(BERLIN).remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-berlin',
      title: 'Appointment',
    });

    expect(await createCalendarMappings(CHENNAI).find('fup_1')).toBeNull();
  });

  /** The second: one event id overwriting another, so a cancel deletes nothing. */
  it('keeps both accounts’ events when both added the same visit', async () => {
    await createCalendarMappings(BERLIN).remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-berlin',
      title: 'Appointment',
    });
    await createCalendarMappings(CHENNAI).remember({
      followUpId: 'fup_1',
      calendarId: 'cal-9',
      eventId: 'event-chennai',
      title: 'Appointment',
    });

    expect((await createCalendarMappings(BERLIN).find('fup_1'))?.eventId).toBe('event-berlin');
    expect((await createCalendarMappings(CHENNAI).find('fup_1'))?.eventId).toBe('event-chennai');
  });

  /**
   * A retried "add to calendar" must not leave two events with only one of them
   * removable.
   */
  it('keeps one event per follow-up on a device, replacing rather than adding', async () => {
    const mappings = createCalendarMappings(BERLIN);
    await mappings.remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-1',
      title: 'Appointment',
    });
    await mappings.remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-2',
      title: 'Appointment',
    });

    expect(await mappings.all()).toHaveLength(1);
    expect((await mappings.find('fup_1'))?.eventId).toBe('event-2');
  });

  it('forgets one mapping without disturbing the others', async () => {
    const mappings = createCalendarMappings(BERLIN);
    await mappings.remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-1',
      title: 'Appointment',
    });
    await mappings.remember({
      followUpId: 'fup_2',
      calendarId: 'cal-1',
      eventId: 'event-2',
      title: 'Appointment',
    });

    await mappings.forget('fup_1');

    expect(await mappings.find('fup_1')).toBeNull();
    expect(await mappings.find('fup_2')).not.toBeNull();
  });

  it('survives a restart', async () => {
    await createCalendarMappings(BERLIN).remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-1',
      title: 'Appointment',
    });

    expect(await createCalendarMappings(BERLIN).find('fup_1')).not.toBeNull();
  });

  it('stores nothing readable on disk', async () => {
    await createCalendarMappings(BERLIN).remember({
      followUpId: 'fup_1',
      calendarId: 'cal-1',
      eventId: 'event-1',
      title: 'Appointment',
    });

    const keys = await AsyncStorage.getAllKeys();
    const values = await Promise.all(keys.map((key) => AsyncStorage.getItem(key)));
    expect(values.join('|')).not.toContain('event-1');
  });
});

describe('how much detail goes into a calendar', () => {
  /** A calendar entry is not private, so the default is the minimum. */
  it('defaults to the minimum', () => {
    expect(DEFAULT_CALENDAR_DETAIL).toBe('minimal');
  });

  it('describes each level in words a user can decide on', () => {
    expect(describeCalendarDetail('minimal')).toMatch(/nothing about who/i);
    expect(describeCalendarDetail('standard')).toMatch(/first name/i);
  });

  /** Neither level ever admits the record itself. */
  it('promises no conditions, medicines or doctor at either level', () => {
    expect(describeCalendarDetail('standard')).toMatch(/no conditions, medicines or doctor/i);
  });
});
