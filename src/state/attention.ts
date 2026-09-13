import type { VaultSnapshot } from './vaultStore';

import type { MedicalDocument, FollowUp } from '@/types/domain';
import { isOverdue } from '@/utils/date';

/**
 * What "needs your attention" is allowed to mean.
 *
 * Every item here is an *administrative* fact about the record — a date that
 * has passed, an upload that failed, a summary nobody has checked yet. None of
 * them is a clinical judgement, and the app must never present them as one:
 * "three items need attention" is a to-do count, not a health assessment.
 *
 * The absence of a fact is deliberately not on this list. A dose with no
 * confirmation is not a missed dose, and a parent with no recent documents is
 * not a parent who is well. See `docs/koode/DESIGN.md` → "Reference limitations
 * to fix in production".
 */
export type AttentionKind =
  /** A scheduled follow-up whose due date has passed. */
  | 'overdue_follow_up'
  /** An upload or processing run that ended in a failure the user can retry. */
  | 'document_failed'
  /** A finished summary that no person has checked against the original yet. */
  | 'document_needs_review';

export interface AttentionItem {
  readonly id: string;
  readonly kind: AttentionKind;
  readonly parentId: string;
  /** Short, plain, and safe to read out by a screen reader. */
  readonly title: string;
  readonly detail: string;
  /** Where tapping it goes. */
  readonly route: string;
}

/**
 * Order matters more than it looks.
 *
 * A passed date is the only kind here that gets worse on its own, so it sorts
 * first. A failed upload is next because the record is missing something the
 * user thinks they filed. An unreviewed summary sits last: nothing is lost
 * while it waits.
 */
const KIND_ORDER: Record<AttentionKind, number> = {
  overdue_follow_up: 0,
  document_failed: 1,
  document_needs_review: 2,
};

const overdueItem = (followUp: FollowUp): AttentionItem => ({
  id: `attention_followup_${followUp.id}`,
  kind: 'overdue_follow_up',
  parentId: followUp.parentId,
  title: followUp.title,
  detail: 'This was due and has not been marked done.',
  route: `/follow-up/${followUp.id}`,
});

const failedItem = (document: MedicalDocument): AttentionItem => ({
  id: `attention_document_failed_${document.id}`,
  kind: 'document_failed',
  parentId: document.parentId,
  title: document.title,
  // The failure reason is the pipeline's own text and can name a page or a
  // format; it is shown on the document screen, not summarised here.
  detail: 'This document did not finish. You can open it and try again.',
  route: `/document/${document.id}`,
});

const reviewItem = (document: MedicalDocument): AttentionItem => ({
  id: `attention_document_review_${document.id}`,
  kind: 'document_needs_review',
  parentId: document.parentId,
  title: document.title,
  detail: 'A summary is ready. Check it against the original before relying on it.',
  route: `/document/${document.id}`,
});

export interface AttentionOptions {
  /** Restricts the list to one record. Omit for the whole family. */
  readonly parentId?: string | undefined;
  readonly now?: Date | undefined;
}

/**
 * The attention list, for one record or for everyone the caller can see.
 *
 * Scoping is the caller's job because this function has no idea what the user
 * is allowed to read — it is given a snapshot and works on exactly that. The
 * grant check happens before the snapshot exists, not here.
 */
export const selectAttentionItems = (
  state: VaultSnapshot,
  { parentId, now = new Date() }: AttentionOptions = {},
): AttentionItem[] => {
  const inScope = <T extends { parentId: string }>(item: T): boolean =>
    parentId === undefined || item.parentId === parentId;

  const items: AttentionItem[] = [
    ...state.followUps
      .filter(
        (followUp) =>
          inScope(followUp) && followUp.status === 'scheduled' && isOverdue(followUp.dueDate, now),
      )
      .map(overdueItem),
    ...state.documents.filter((doc) => inScope(doc) && doc.status === 'failed').map(failedItem),
    ...state.documents
      .filter(
        (doc) =>
          inScope(doc) &&
          doc.status === 'ready' &&
          doc.summaryId !== null &&
          // `undefined` means the document predates review and is treated as
          // unreviewed, which is the safe direction: it asks for a check that
          // may be unnecessary rather than skipping one that was needed.
          (doc.reviewedAt === null || doc.reviewedAt === undefined),
      )
      .map(reviewItem),
  ];

  return items.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
};

/**
 * How many items a parent's card should show.
 *
 * Zero is a real answer and must render as "nothing needs attention", never as
 * a reassurance about the person's health.
 */
export const countAttentionItems = (state: VaultSnapshot, parentId: string, now?: Date): number =>
  selectAttentionItems(state, { parentId, ...(now === undefined ? {} : { now }) }).length;
