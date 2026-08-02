/**
 * Core domain model.
 *
 * These shapes intentionally mirror the planned DynamoDB single-table item
 * schema so the mock services and the future Lambda handlers speak the same
 * language. See README → "Data model" for the PK/SK layout.
 */

/** ISO-8601 timestamp, e.g. `2026-07-30T09:15:00.000Z`. */
export type IsoDateTime = string;
/** ISO-8601 calendar date, e.g. `2026-07-30`. */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Parents
// ---------------------------------------------------------------------------

export type Relationship = 'mother' | 'father' | 'grandmother' | 'grandfather' | 'other';

export type BloodGroup = 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'unknown';

export interface ParentProfile {
  readonly id: string;
  fullName: string;
  relationship: Relationship;
  /** Kept as a date rather than an age so the profile does not go stale. */
  dateOfBirth: IsoDate | null;
  bloodGroup: BloodGroup;
  /** City in India where they live — used for locating a doctor later. */
  city: string;
  phone: string;
  /** Free-text list of long-running conditions, one per entry. */
  conditions: string[];
  allergies: string[];
  /** Doctor/clinic the family usually goes to. */
  primaryDoctor: string;
  notes: string;
  /** Colour token used for the avatar chip so profiles are easy to tell apart. */
  avatarColor: string;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type ParentDraft = Omit<ParentProfile, 'id' | 'createdAt' | 'updatedAt' | 'avatarColor'> &
  Partial<Pick<ParentProfile, 'avatarColor'>>;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** How a page entered the app. Drives analytics and the capture UX. */
export type CaptureSource = 'scan' | 'camera' | 'gallery' | 'file';

export type DocumentKind = 'image' | 'pdf';

export interface DocumentPage {
  readonly id: string;
  /** Local `file://` URI while pending; S3 key once uploaded. */
  uri: string;
  kind: DocumentKind;
  source: CaptureSource;
  /** Original filename when it came from the file picker. */
  fileName: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  readonly capturedAt: IsoDateTime;
}

export type DocumentCategory =
  | 'lab_report'
  | 'prescription'
  | 'discharge_summary'
  | 'imaging'
  | 'consultation_note'
  | 'insurance'
  | 'other';

export type ProcessingStatus =
  'draft' | 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';

export interface MedicalDocument {
  readonly id: string;
  readonly parentId: string;
  title: string;
  category: DocumentCategory;
  /** Date printed on the report, not the date it was scanned. */
  documentDate: IsoDate;
  pages: DocumentPage[];
  status: ProcessingStatus;
  /** Percent 0–100 across all pages; only meaningful while `uploading`. */
  uploadProgress: number;
  /** Present once the processing pipeline has produced a summary. */
  summaryId: string | null;
  /** Human-readable reason when `status === 'failed'`. */
  failureReason: string | null;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// AI summary
// ---------------------------------------------------------------------------

export type FindingSeverity = 'normal' | 'watch' | 'attention';

export interface SummaryFinding {
  readonly id: string;
  /** e.g. "Fasting blood sugar". */
  label: string;
  /** e.g. "142 mg/dL". */
  value: string;
  /** e.g. "70–100 mg/dL". */
  referenceRange: string | null;
  severity: FindingSeverity;
  /** One sentence, no jargon — this is what the child abroad actually reads. */
  plainLanguage: string;
}

export interface MedicineMention {
  readonly id: string;
  name: string;
  /** e.g. "500 mg". */
  dosage: string;
  /** e.g. "Twice a day after food". */
  frequency: string;
  /** e.g. "Blood sugar control". */
  purpose: string;
}

/** Maps to the specialist the family should book next. */
export type DoctorCategory =
  | 'general_physician'
  | 'cardiologist'
  | 'endocrinologist'
  | 'nephrologist'
  | 'orthopaedic'
  | 'ophthalmologist'
  | 'pulmonologist'
  | 'neurologist'
  | 'gastroenterologist'
  | 'dermatologist';

export interface DocumentSummary {
  readonly id: string;
  readonly documentId: string;
  readonly parentId: string;
  /** What kind of document this is and where it came from, in one line. */
  overview: string;
  /** 2–4 sentences a non-medical family member can act on. */
  plainLanguageSummary: string;
  findings: SummaryFinding[];
  medicines: MedicineMention[];
  /** Instructions transcribed from the document itself — never invented. */
  instructions: string[];
  recommendedDoctorCategory: DoctorCategory;
  /** Prompts for the next consultation. */
  questionsForDoctor: string[];
  /** 0–1. Surfaced in the UI so low-confidence output is visibly hedged. */
  confidence: number;
  /** Model/pipeline identifier, for auditability. */
  generatedBy: string;
  readonly generatedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Follow-ups
// ---------------------------------------------------------------------------

export type FollowUpStatus = 'scheduled' | 'completed' | 'missed' | 'cancelled';

export type FollowUpKind =
  'doctor_visit' | 'lab_test' | 'medicine_refill' | 'vaccination' | 'physiotherapy' | 'other';

export interface FollowUp {
  readonly id: string;
  readonly parentId: string;
  title: string;
  kind: FollowUpKind;
  dueDate: IsoDate;
  /** Optional time of day, `HH:mm` in the parent's local (IST) clock. */
  dueTime: string | null;
  notes: string;
  status: FollowUpStatus;
  /** Document that prompted this follow-up, when there is one. */
  sourceDocumentId: string | null;
  doctorCategory: DoctorCategory | null;
  /** Set only after the user explicitly confirms the calendar prompt. */
  calendarEventId: string | null;
  readonly createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type FollowUpDraft = Omit<
  FollowUp,
  'id' | 'createdAt' | 'updatedAt' | 'calendarEventId' | 'status'
> &
  Partial<Pick<FollowUp, 'status'>>;

// ---------------------------------------------------------------------------
// Account & privacy
// ---------------------------------------------------------------------------

export interface AuthUser {
  readonly id: string;
  email: string;
  fullName: string;
  /** Where the caregiver lives, e.g. "Berlin, Germany". */
  location: string;
  readonly createdAt: IsoDateTime;
}

export type AppLockMethod = 'none' | 'pin' | 'biometric';

export interface PrivacySettings {
  lockMethod: AppLockMethod;
  /** Minutes of background time before the vault re-locks. */
  autoLockMinutes: number;
  /** Opt-in, off by default. */
  analyticsEnabled: boolean;
  /** Opt-in, off by default — controls whether summaries may be used for QA. */
  shareAnonymisedDataForImprovement: boolean;
  /** User must accept the medical disclaimer before entering the app. */
  disclaimerAcceptedAt: IsoDateTime | null;
  /** Calendar writes always require a per-event confirmation on top of this. */
  calendarSyncEnabled: boolean;
}
