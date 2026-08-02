import type { FollowUp } from '@/types/domain';
import { isoToday, nowIso } from '@/utils/date';

/**
 * Seed follow-ups.
 *
 * Dates are computed relative to today rather than hard-coded, so the demo
 * dashboard always shows a believable mix of overdue, due-soon and upcoming
 * items no matter when the app is opened.
 */
export const buildMockFollowUps = (): FollowUp[] => {
  const created = nowIso();

  return [
    {
      id: 'fup_demo_1',
      parentId: 'par_demo_amma',
      title: 'Review diabetes panel with Dr. Meera',
      kind: 'doctor_visit',
      dueDate: isoToday(2),
      dueTime: '10:30',
      notes: 'Carry the July lab report and the home blood pressure readings.',
      status: 'scheduled',
      sourceDocumentId: 'doc_demo_hba1c',
      doctorCategory: 'endocrinologist',
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'fup_demo_2',
      parentId: 'par_demo_amma',
      title: 'Refill Telmisartan and Metformin',
      kind: 'medicine_refill',
      dueDate: isoToday(-3),
      dueTime: null,
      notes: 'One month supply. Pharmacy on 2nd Main delivers.',
      status: 'scheduled',
      sourceDocumentId: 'doc_demo_bp_rx',
      doctorCategory: null,
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'fup_demo_3',
      parentId: 'par_demo_amma',
      title: 'Repeat HbA1c test',
      kind: 'lab_test',
      dueDate: isoToday(74),
      dueTime: '08:00',
      notes: 'Fasting sample — nothing to eat after 10pm the night before.',
      status: 'scheduled',
      sourceDocumentId: 'doc_demo_hba1c',
      doctorCategory: null,
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'fup_demo_4',
      parentId: 'par_demo_appa',
      title: 'Physiotherapy session',
      kind: 'physiotherapy',
      dueDate: isoToday(1),
      dueTime: '17:00',
      notes: 'Twice weekly — Tuesday and Friday.',
      status: 'scheduled',
      sourceDocumentId: 'doc_demo_knee',
      doctorCategory: null,
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'fup_demo_5',
      parentId: 'par_demo_appa',
      title: 'Show knee X-ray to Dr. Suresh Babu',
      kind: 'doctor_visit',
      dueDate: isoToday(9),
      dueTime: '11:00',
      notes: 'Ask about the mild wear noted in the left knee.',
      status: 'scheduled',
      sourceDocumentId: 'doc_demo_xray',
      doctorCategory: 'orthopaedic',
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
    {
      id: 'fup_demo_6',
      parentId: 'par_demo_appa',
      title: 'Six-month knee X-ray',
      kind: 'lab_test',
      dueDate: isoToday(-32),
      dueTime: null,
      notes: 'Done at Kauvery imaging centre.',
      status: 'completed',
      sourceDocumentId: 'doc_demo_knee',
      doctorCategory: 'orthopaedic',
      calendarEventId: null,
      createdAt: created,
      updatedAt: created,
    },
  ];
};
