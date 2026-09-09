import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Callout,
  Card,
  DemoNotice,
  DoseCard,
  EmptyState,
  IdentityHeader,
  Screen,
  SectionHeader,
  Text,
} from '@/components';
import { useExperience } from '@/services/experience';
import { nextDueDose, recordDose, undoDose } from '@/services/treatment/occurrences';
import { DEFAULT_TIMEZONE, localDateIn } from '@/services/treatment/patientClock';
import { pushDoseEvent } from '@/services/sync/dailyCare';
import { useSessionStore } from '@/state/sessionStore';
import {
  selectDosesForDay,
  selectFollowUpsForParent,
  selectLiveSchedules,
  selectParent,
  useVaultSnapshot,
  useVaultStore,
} from '@/state/vaultStore';
import { colors, spacing } from '@/theme';
import type { DoseOccurrence, DoseState } from '@/types/treatment';
import { describeDueDate, formatTime, isOverdue } from '@/utils/date';
import { pluralise } from '@/utils/format';

/**
 * The parent's Today screen: the next useful action, and very little else.
 *
 * The order the approved reference sets, and the rule that governs it:
 *
 *   1. A dose that is due, when a *confirmed* schedule says one is.
 *   2. Otherwise the next appointment, or adding a document.
 *   3. Then visit preparation, capture, a short note, and the family helper.
 *
 * ## Where the dose comes from
 *
 * From `TreatmentSchedule` records only — medicines somebody confirmed they are
 * taking, at times somebody chose. Never from a summary. A medicine a model
 * read off a prescription is a *mention*: it has no times, may have been found
 * in a two-year-old letter, and nobody has agreed to it. Turning one into a
 * card with a button would be an instruction to take a drug, issued on the
 * strength of an OCR pass over a photograph.
 *
 * ## Not recorded is not missed
 *
 * The card shows an unanswered dose as "not recorded" and offers "I haven't
 * taken it" as an explicit action. Nothing on this screen ever concludes a
 * tablet was skipped because nobody opened the app.
 */
export default function ParentTodayScreen(): React.JSX.Element {
  const router = useRouter();
  const user = useSessionStore((state) => state.user);
  const { selfRecordId } = useExperience();
  const vault = useVaultSnapshot();
  const appendDoseEvent = useVaultStore((state) => state.appendDoseEvent);

  const record = selfRecordId === null ? undefined : selectParent(vault, selfRecordId);

  /**
   * The patient's own day, not the device's.
   *
   * Taken from a live schedule when there is one, because that is where the
   * zone was recorded; the default only decides what to show somebody who has
   * no schedule yet, which is a screen with no dose on it either way.
   */
  const schedules = record === undefined ? [] : selectLiveSchedules(vault, record.id);
  const timezone = schedules[0]?.timezone ?? DEFAULT_TIMEZONE;
  const today = localDateIn(timezone);

  const doses =
    record === undefined ? [] : selectDosesForDay(vault, record.id, today);
  const nextDose = nextDueDose(doses);
  const recordedToday = doses.filter((dose) => dose.state !== null).length;

  /**
   * The dose just answered stays on screen.
   *
   * Without this the card jumps straight to the evening's dose the moment the
   * morning one is answered, and the person is left wondering whether their tap
   * registered — with no way back if it was the wrong button. Holding the
   * answered dose shows what was recorded and keeps undo within reach.
   */
  const [justAnsweredKey, setJustAnsweredKey] = useState<string | null>(null);
  const shownDose =
    doses.find((dose) => dose.occurrenceKey === justAnsweredKey) ?? nextDose;

  const nextVisit =
    record === undefined
      ? undefined
      : selectFollowUpsForParent(vault, record.id).find((item) => item.status === 'scheduled');

  const firstName = (record?.fullName ?? user?.fullName ?? '').split(' ')[0] ?? '';

  /**
   * Recording is a store append, not an edit.
   *
   * `recordDose` returns null when the tap would change nothing — the same dose
   * already in the same state — and `appendDoseEvent` ignores null, so a double
   * tap cannot produce two entries for one tablet.
   */
  const recordFor = (occurrence: DoseOccurrence, state: DoseState): void => {
    const recorded = recordDose({
      occurrence,
      state,
      recordedBy: user?.id ?? 'usr_local',
      // This is the patient's own screen, so it is their own confirmation.
      recordedBySelf: true,
    });
    // Sent only if the store actually recorded it: a duplicate tap writes
    // nothing here, and must put nothing on anybody else's phone either.
    void pushDoseEvent(appendDoseEvent(recorded));
    setJustAnsweredKey(occurrence.occurrenceKey);
  };

  const undoFor = (occurrence: DoseOccurrence): void => {
    const undone = undoDose(occurrence, user?.id ?? 'usr_local', true);
    void pushDoseEvent(appendDoseEvent(undone));
    setJustAnsweredKey(null);
  };

  const header = (
    <IdentityHeader
      name={record?.fullName ?? user?.fullName ?? 'Signed in'}
      context="My personal space"
      onOpenSettings={() => router.push('/settings')}
      testID="me-header"
    />
  );

  if (record === undefined) {
    return (
      <Screen testID="me-today-empty">
        {header}
        <EmptyState
          icon="person-outline"
          title="Your record is not set up yet"
          message="Once your own health record exists, this screen shows your next step for the day."
          testID="me-today-empty-state"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="me-today">
      {header}

      <View style={styles.greeting}>
        <Text variant="title" accessibilityRole="header">
          {firstName ? `Hello, ${firstName}.` : 'Hello.'}
        </Text>
        <DemoNotice />
      </View>

      {schedules.length === 0 ? (
        /*
          The no-treatment state. It says what is true — nobody has set up a
          schedule — and offers the action that would change that, rather than
          implying the absence means anything about the person's health.
        */
        <Card tone="quiet" style={styles.stacked} testID="me-today-no-treatment">
          <Text variant="caption" tone="secondary">
            Today
          </Text>
          <Text variant="heading">No medicine schedule set up</Text>
          <Text variant="callout" tone="secondary">
            When a medicine from your prescription is confirmed, it will appear here with a large
            button to record that you took it. Nothing is being tracked until then.
          </Text>
          <Button
            label="Add a medicine"
            variant="secondary"
            icon="medkit-outline"
            onPress={() => router.push(`/treatment/new?patientId=${record.id}`)}
            style={styles.action}
            testID="me-today-add-medicine"
          />
        </Card>
      ) : shownDose !== null ? (
        <DoseCard
          occurrence={shownDose}
          timezone={timezone}
          bySelf
          onTaken={() => recordFor(shownDose, 'taken')}
          onMissed={() => recordFor(shownDose, 'missed')}
          onUndo={() => undoFor(shownDose)}
          testID="me-today-dose"
        />
      ) : (
        /*
          Everything due today has an answer. Said as a fact about the record —
          not "well done", and not a claim that the medicine is working.
        */
        <Card tone="quiet" style={styles.stacked} testID="me-today-doses-done">
          <Text variant="caption" tone="secondary">
            Today
          </Text>
          <Text variant="heading">Nothing else due today</Text>
          <Text variant="callout" tone="secondary">
            {recordedToday === doses.length
              ? `All ${pluralise(doses.length, 'dose')} for today have been answered.`
              : 'There is nothing more to record today.'}
          </Text>
          <Button
            label="See today’s medicines"
            variant="secondary"
            icon="list-outline"
            onPress={() => router.push('/me/health')}
            style={styles.action}
            testID="me-today-see-medicines"
          />
        </Card>
      )}

      {nextVisit === undefined ? (
        <Card tone="appointment" style={styles.stacked} testID="me-today-no-visit">
          <Text variant="caption" tone="secondary">
            Next visit
          </Text>
          <Text variant="heading">Nothing booked</Text>
          <Text variant="callout" style={styles.onAppointment}>
            Add your next appointment so it is here when you need it.
          </Text>
          <Button
            label="Add a document instead"
            variant="secondary"
            icon="camera-outline"
            onPress={() => router.push('/capture')}
            style={styles.action}
            testID="me-today-add-document-alt"
          />
        </Card>
      ) : (
        <Card
          tone="appointment"
          style={styles.stacked}
          onPress={() => router.push(`/follow-up/${nextVisit.id}`)}
          accessibilityLabel={`Your next visit. ${nextVisit.title}. ${describeDueDate(nextVisit.dueDate)}.`}
          accessibilityHint="Opens this visit"
          testID="me-today-visit"
        >
          <Text variant="caption" tone="secondary">
            Your next visit
          </Text>
          <Text variant="heading">{nextVisit.title}</Text>
          <Text variant="callout" style={styles.onAppointment}>
            {describeDueDate(nextVisit.dueDate)}
            {formatTime(nextVisit.dueTime) === null
              ? ''
              : ` · ${formatTime(nextVisit.dueTime)} IST`}
            {isOverdue(nextVisit.dueDate) ? ' · this date has passed' : ''}
          </Text>
        </Card>
      )}

      <SectionHeader title="What would you like to do?" testID="me-today-actions-header" />

      <Button
        label="Add a document"
        icon="camera-outline"
        onPress={() => router.push('/capture')}
        style={styles.action}
        testID="me-today-add-document"
      />
      <Button
        label="How I am feeling"
        variant="secondary"
        icon="heart-outline"
        onPress={() => router.push('/me/health')}
        style={styles.action}
        testID="me-today-symptom"
      />

      <Callout
        tone="neutral"
        title="Your family helper"
        message="Nobody can see this record unless you have given them access. You can check who has it, and take it back, under Family."
        testID="me-today-helper-notice"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: spacing.md },
  greeting: { gap: spacing.sm, paddingTop: spacing.lg },
  onAppointment: { color: colors.onSurfaceAppointment },
  stacked: { gap: spacing.xs, marginTop: spacing.lg },
});
