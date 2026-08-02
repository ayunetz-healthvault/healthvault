import type {
  DoctorCategory,
  DocumentCategory,
  FindingSeverity,
  FollowUpKind,
  FollowUpStatus,
  ProcessingStatus,
  Relationship,
} from './domain';

/**
 * Display strings for the enum-ish domain unions.
 *
 * Kept in one place so copy stays consistent and so swapping in i18n later is a
 * single-file change. TODO(i18n): replace with translation keys (Hindi, Tamil,
 * Telugu, Bengali are the priority languages for the parent-facing screens).
 */

export const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  mother: 'Mother',
  father: 'Father',
  grandmother: 'Grandmother',
  grandfather: 'Grandfather',
  other: 'Other',
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  lab_report: 'Lab report',
  prescription: 'Prescription',
  discharge_summary: 'Discharge summary',
  imaging: 'Scan or X-ray',
  consultation_note: 'Consultation note',
  insurance: 'Insurance',
  other: 'Other',
};

export const PROCESSING_STATUS_LABELS: Record<ProcessingStatus, string> = {
  draft: 'Draft',
  uploading: 'Uploading',
  uploaded: 'Uploaded',
  processing: 'Reading document',
  ready: 'Ready',
  failed: 'Needs attention',
};

export const FOLLOW_UP_KIND_LABELS: Record<FollowUpKind, string> = {
  doctor_visit: 'Doctor visit',
  lab_test: 'Lab test',
  medicine_refill: 'Medicine refill',
  vaccination: 'Vaccination',
  physiotherapy: 'Physiotherapy',
  other: 'Other',
};

export const FOLLOW_UP_STATUS_LABELS: Record<FollowUpStatus, string> = {
  scheduled: 'Scheduled',
  completed: 'Done',
  missed: 'Missed',
  cancelled: 'Cancelled',
};

export const DOCTOR_CATEGORY_LABELS: Record<DoctorCategory, string> = {
  general_physician: 'General physician',
  cardiologist: 'Cardiologist (heart)',
  endocrinologist: 'Endocrinologist (diabetes, thyroid)',
  nephrologist: 'Nephrologist (kidney)',
  orthopaedic: 'Orthopaedic (bones and joints)',
  ophthalmologist: 'Ophthalmologist (eyes)',
  pulmonologist: 'Pulmonologist (lungs)',
  neurologist: 'Neurologist (brain and nerves)',
  gastroenterologist: 'Gastroenterologist (stomach)',
  dermatologist: 'Dermatologist (skin)',
};

export const FINDING_SEVERITY_LABELS: Record<FindingSeverity, string> = {
  normal: 'In range',
  watch: 'Keep an eye on it',
  attention: 'Discuss with the doctor',
};

export const RELATIONSHIP_OPTIONS = Object.keys(RELATIONSHIP_LABELS) as Relationship[];
export const DOCUMENT_CATEGORY_OPTIONS = Object.keys(
  DOCUMENT_CATEGORY_LABELS,
) as DocumentCategory[];
export const FOLLOW_UP_KIND_OPTIONS = Object.keys(FOLLOW_UP_KIND_LABELS) as FollowUpKind[];
export const DOCTOR_CATEGORY_OPTIONS = Object.keys(DOCTOR_CATEGORY_LABELS) as DoctorCategory[];
