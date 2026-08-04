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
// Source traceability & privacy metadata
//
// Added for the Phase 1 privacy-first processing pipeline (docs/architecture).
// Everything here is optional on the existing shapes so summaries written
// before the pipeline existed — including the seeded demo data — stay valid.
// ---------------------------------------------------------------------------

/**
 * Points a summary item back at the page it was read from, so the family can
 * check any number against the original scan.
 *
 * `textSnippet` is optional and, when present, must be cut from the *redacted*
 * text and pass the leakage gate — it must never reintroduce an identifier.
 * See ADR-002 → "Source snippets".
 */
export interface SourceReference {
  documentId: string;
  /** 1-based page number within the document. */
  page: number;
  textSnippet?: string;
}

/**
 * Something the pipeline could not read confidently. Surfaced in the UI rather
 * than silently dropped, because a missing value on a lab report matters.
 */
export interface SummaryUncertainty {
  message: string;
  /** Page it relates to, or `null` when it is document-wide. */
  sourcePage: number | null;
}

/**
 * Identifier classes the redactor removes before any text leaves the Ayunetz
 * boundary. Mirrors the typed placeholders in ADR-002; `other` is the
 * deliberate catch-all so the union can stay closed.
 */
export type RedactionCategory =
  | 'patientName'
  | 'personName'
  | 'address'
  | 'phone'
  | 'email'
  | 'dateOfBirth'
  | 'aadhaar'
  | 'pan'
  | 'passport'
  | 'patientId'
  | 'insuranceId'
  | 'other';

/**
 * Non-sensitive record of what the privacy pipeline did.
 *
 * Counts only — the removed values are never carried here, in the API response
 * or in logs. `possiblePiiRemaining` true means the leakage gate failed and no
 * external AI call was made.
 */
export interface PrivacyProcessingResult {
  redactionApplied: boolean;
  possiblePiiRemaining: boolean;
  redactedEntityCounts: Record<RedactionCategory, number>;
  /** e.g. `redaction-v1` — pins a summary to the rules that produced it. */
  pipelineVersion: string;
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
  /**
   * Unit on its own, e.g. "mg/dL", when the pipeline could separate it from
   * `value`. `value` stays the display string either way.
   */
  unit?: string | null;
  /** Where this was read from. Required in spirit for abnormal values. */
  sources?: SourceReference[];
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
  /** e.g. "14 days", when the document states one. */
  duration?: string | null;
  sources?: SourceReference[];
}

/**
 * A follow-up the document itself asks for — "repeat HbA1c in three months",
 * "review in four weeks".
 *
 * Kept separate from {@link FollowUp}, which is the record the user owns. This
 * is a reading of the document, not a commitment: the UI must not let a
 * generated suggestion be mistaken for something the doctor wrote.
 */
export interface ExplicitFollowUp {
  title: string;
  /** `null` when the document gives an interval but no resolvable date. */
  date: IsoDate | null;
  kind: FollowUpKind;
  source: SourceReference;
  /** 0–1. */
  confidence: number;
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
  /**
   * Date the pipeline read off the document, which can disagree with
   * `MedicalDocument.documentDate` entered by the user. Both are kept.
   */
  detectedDocumentDate?: IsoDate | null;
  /** Follow-ups written in the document, with page sources. */
  explicitFollowUps?: ExplicitFollowUp[];
  /** What could not be read confidently. */
  uncertainties?: SummaryUncertainty[];
  /** What the redaction and leakage gate did before the AI call. */
  privacy?: PrivacyProcessingResult;
  /** Processing-pipeline version, distinct from `privacy.pipelineVersion`. */
  pipelineVersion?: string;
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
