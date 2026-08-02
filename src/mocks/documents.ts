import type { DocumentSummary, MedicalDocument } from '@/types/domain';

/**
 * Seed documents and their summaries.
 *
 * The page URIs point at `https://` placeholders rather than `file://` because
 * there is nothing on a fresh device's filesystem to point at; the document
 * viewer falls back to a page-number placeholder when an image will not load.
 */

const PLACEHOLDER_PAGE = 'https://placehold.co/1240x1754/F1F5F3/3A4A45?text=Report+page';

export const MOCK_DOCUMENTS: MedicalDocument[] = [
  {
    id: 'doc_demo_hba1c',
    parentId: 'par_demo_amma',
    title: 'Quarterly diabetes panel',
    category: 'lab_report',
    documentDate: '2026-07-12',
    pages: [
      {
        id: 'pag_demo_hba1c_1',
        uri: `${PLACEHOLDER_PAGE}+1`,
        kind: 'image',
        source: 'scan',
        fileName: 'diabetes-panel-p1.jpg',
        sizeBytes: 842_000,
        width: 1240,
        height: 1754,
        capturedAt: '2026-07-14T11:18:00.000Z',
      },
      {
        id: 'pag_demo_hba1c_2',
        uri: `${PLACEHOLDER_PAGE}+2`,
        kind: 'image',
        source: 'scan',
        fileName: 'diabetes-panel-p2.jpg',
        sizeBytes: 776_000,
        width: 1240,
        height: 1754,
        capturedAt: '2026-07-14T11:18:40.000Z',
      },
    ],
    status: 'ready',
    uploadProgress: 100,
    summaryId: 'sum_demo_hba1c',
    failureReason: null,
    createdAt: '2026-07-14T11:20:00.000Z',
    updatedAt: '2026-07-14T11:23:00.000Z',
  },
  {
    id: 'doc_demo_bp_rx',
    parentId: 'par_demo_amma',
    title: 'Prescription — Dr. Meera Krishnan',
    category: 'prescription',
    documentDate: '2026-07-12',
    pages: [
      {
        id: 'pag_demo_bp_rx_1',
        uri: `${PLACEHOLDER_PAGE}`,
        kind: 'image',
        source: 'camera',
        fileName: 'prescription-jul.jpg',
        sizeBytes: 512_300,
        width: 1080,
        height: 1440,
        capturedAt: '2026-07-14T11:25:00.000Z',
      },
    ],
    status: 'ready',
    uploadProgress: 100,
    summaryId: 'sum_demo_bp_rx',
    failureReason: null,
    createdAt: '2026-07-14T11:26:00.000Z',
    updatedAt: '2026-07-14T11:28:00.000Z',
  },
  {
    id: 'doc_demo_knee',
    parentId: 'par_demo_appa',
    title: 'Knee replacement discharge summary',
    category: 'discharge_summary',
    documentDate: '2026-03-22',
    pages: [
      {
        id: 'pag_demo_knee_1',
        uri: `${PLACEHOLDER_PAGE}+1`,
        kind: 'pdf',
        source: 'file',
        fileName: 'discharge-summary-mar2026.pdf',
        sizeBytes: 1_240_000,
        width: null,
        height: null,
        capturedAt: '2026-03-25T06:10:00.000Z',
      },
    ],
    status: 'ready',
    uploadProgress: 100,
    summaryId: 'sum_demo_knee',
    failureReason: null,
    createdAt: '2026-03-25T06:12:00.000Z',
    updatedAt: '2026-03-25T06:15:00.000Z',
  },
  {
    id: 'doc_demo_xray',
    parentId: 'par_demo_appa',
    title: 'Right knee X-ray (6-month review)',
    category: 'imaging',
    documentDate: '2026-06-28',
    pages: [
      {
        id: 'pag_demo_xray_1',
        uri: `${PLACEHOLDER_PAGE}`,
        kind: 'image',
        source: 'gallery',
        fileName: 'knee-xray-jun.jpg',
        sizeBytes: 968_000,
        width: 1200,
        height: 1600,
        capturedAt: '2026-06-30T07:40:00.000Z',
      },
    ],
    status: 'ready',
    uploadProgress: 100,
    summaryId: 'sum_demo_xray',
    failureReason: null,
    createdAt: '2026-06-30T07:45:00.000Z',
    updatedAt: '2026-06-30T07:48:00.000Z',
  },
];

export const MOCK_SUMMARIES: DocumentSummary[] = [
  {
    id: 'sum_demo_hba1c',
    documentId: 'doc_demo_hba1c',
    parentId: 'par_demo_amma',
    overview:
      'A two-page pathology lab report dated 12 July 2026, covering blood sugar, kidney function and cholesterol.',
    plainLanguageSummary:
      'Your mother’s average blood sugar over the last three months is higher than the target for someone with diabetes, and it has drifted up since the April test. Kidney function and cholesterol are both in the normal range, which is good news. The lab has flagged the HbA1c and fasting sugar values for the doctor to review.',
    findings: [
      {
        id: 'fnd_demo_1',
        label: 'HbA1c (3-month average sugar)',
        value: '8.1 %',
        referenceRange: 'Below 7.0 % for people with diabetes',
        severity: 'attention',
        plainLanguage:
          'Average blood sugar has been above target for the past three months, up from 7.4 % in April.',
      },
      {
        id: 'fnd_demo_2',
        label: 'Fasting blood sugar',
        value: '142 mg/dL',
        referenceRange: '70–100 mg/dL',
        severity: 'attention',
        plainLanguage: 'Morning sugar before food is higher than it should be.',
      },
      {
        id: 'fnd_demo_3',
        label: 'Serum creatinine (kidney)',
        value: '0.9 mg/dL',
        referenceRange: '0.6–1.1 mg/dL',
        severity: 'normal',
        plainLanguage: 'Kidneys are filtering normally.',
      },
      {
        id: 'fnd_demo_4',
        label: 'LDL cholesterol',
        value: '96 mg/dL',
        referenceRange: 'Below 100 mg/dL',
        severity: 'normal',
        plainLanguage: 'The “bad” cholesterol is within the target range.',
      },
      {
        id: 'fnd_demo_5',
        label: 'Vitamin D',
        value: '22 ng/mL',
        referenceRange: '30–100 ng/mL',
        severity: 'watch',
        plainLanguage: 'Slightly low — common and usually easy to correct with a supplement.',
      },
    ],
    medicines: [
      {
        id: 'med_demo_1',
        name: 'Metformin',
        dosage: '1000 mg',
        frequency: 'Twice a day, after food',
        purpose: 'Controls blood sugar',
      },
      {
        id: 'med_demo_2',
        name: 'Glimepiride',
        dosage: '2 mg',
        frequency: 'Once a day, before breakfast',
        purpose: 'Helps the body release more insulin',
      },
    ],
    instructions: [
      'Repeat the HbA1c test in three months.',
      'Continue the current diabetes medicines until the doctor reviews this report.',
      'Fasting sample was taken after 10 hours without food, as advised.',
      'Bring this report to the next consultation.',
    ],
    recommendedDoctorCategory: 'endocrinologist',
    questionsForDoctor: [
      'HbA1c has gone from 7.4 % to 8.1 % since April — does the medicine dose need changing?',
      'Should we check blood sugar at home more often, and at what times of day?',
      'Is the low vitamin D worth treating with a supplement?',
      'Are there specific foods to cut back on given the morning sugar reading?',
    ],
    confidence: 0.88,
    generatedBy: 'ayunetz-mock-summariser/0.1',
    generatedAt: '2026-07-14T11:23:00.000Z',
  },
  {
    id: 'sum_demo_bp_rx',
    documentId: 'doc_demo_bp_rx',
    parentId: 'par_demo_amma',
    overview:
      'A handwritten prescription from Dr. Meera Krishnan dated 12 July 2026, issued at the same visit as the lab report.',
    plainLanguageSummary:
      'The doctor has kept the diabetes medicines unchanged and added a low-dose blood pressure tablet to be taken in the morning. A review visit is asked for in four weeks, with blood pressure readings noted down at home in the meantime.',
    findings: [
      {
        id: 'fnd_demo_6',
        label: 'Blood pressure recorded at visit',
        value: '148 / 92 mmHg',
        referenceRange: 'Below 140 / 90 mmHg',
        severity: 'watch',
        plainLanguage: 'Blood pressure was a little high on the day of the visit.',
      },
    ],
    medicines: [
      {
        id: 'med_demo_3',
        name: 'Telmisartan',
        dosage: '40 mg',
        frequency: 'Once a day, in the morning',
        purpose: 'Lowers blood pressure',
      },
      {
        id: 'med_demo_4',
        name: 'Metformin',
        dosage: '1000 mg',
        frequency: 'Twice a day, after food',
        purpose: 'Controls blood sugar (continued, unchanged)',
      },
    ],
    instructions: [
      'Take the blood pressure tablet in the morning, at the same time each day.',
      'Record blood pressure at home twice a week and bring the readings.',
      'Return for review in four weeks.',
      'Report any dizziness on standing.',
    ],
    recommendedDoctorCategory: 'general_physician',
    questionsForDoctor: [
      'Should the blood pressure tablet be taken before or after breakfast?',
      'What blood pressure reading at home would mean we should call sooner?',
      'Does this new tablet interact with the diabetes medicines?',
    ],
    confidence: 0.79,
    generatedBy: 'ayunetz-mock-summariser/0.1',
    generatedAt: '2026-07-14T11:28:00.000Z',
  },
  {
    id: 'sum_demo_knee',
    documentId: 'doc_demo_knee',
    parentId: 'par_demo_appa',
    overview:
      'A four-page hospital discharge summary following right total knee replacement surgery, dated 22 March 2026.',
    plainLanguageSummary:
      'Your father had a full right knee replacement and recovered without complications. He was discharged walking with a frame, on a short course of pain relief and a blood thinner. The surgical team asked for physiotherapy twice a week and a follow-up X-ray at six months.',
    findings: [
      {
        id: 'fnd_demo_7',
        label: 'Surgery',
        value: 'Right total knee replacement',
        referenceRange: null,
        severity: 'normal',
        plainLanguage: 'The operation was completed as planned, with no complications recorded.',
      },
      {
        id: 'fnd_demo_8',
        label: 'Haemoglobin at discharge',
        value: '11.2 g/dL',
        referenceRange: '13.0–17.0 g/dL',
        severity: 'watch',
        plainLanguage:
          'Mildly low after surgery, which is expected — worth rechecking at the follow-up.',
      },
    ],
    medicines: [
      {
        id: 'med_demo_5',
        name: 'Paracetamol',
        dosage: '650 mg',
        frequency: 'Up to three times a day, as needed for pain',
        purpose: 'Pain relief',
      },
      {
        id: 'med_demo_6',
        name: 'Rivaroxaban',
        dosage: '10 mg',
        frequency: 'Once a day for 14 days',
        purpose: 'Prevents blood clots after surgery',
      },
    ],
    instructions: [
      'Physiotherapy twice a week for at least twelve weeks.',
      'Keep the wound dry until the staples are removed on day 14.',
      'Walk with the frame until the physiotherapist advises otherwise.',
      'Follow-up X-ray of the right knee at six months.',
      'Return immediately if there is fever, calf swelling or increasing redness at the wound.',
    ],
    recommendedDoctorCategory: 'orthopaedic',
    questionsForDoctor: [
      'Is the current level of walking what you would expect six months after surgery?',
      'Should the haemoglobin be rechecked?',
      'How much longer should physiotherapy continue?',
    ],
    confidence: 0.91,
    generatedBy: 'ayunetz-mock-summariser/0.1',
    generatedAt: '2026-03-25T06:15:00.000Z',
  },
  {
    id: 'sum_demo_xray',
    documentId: 'doc_demo_xray',
    parentId: 'par_demo_appa',
    overview: 'A single-page radiology report for a right knee X-ray taken on 28 June 2026.',
    plainLanguageSummary:
      'The X-ray shows the knee replacement sitting correctly with no sign of loosening. The radiologist noted mild wear in the left knee, which was not operated on, and suggested the surgeon look at it at the next visit.',
    findings: [
      {
        id: 'fnd_demo_9',
        label: 'Right knee implant position',
        value: 'Well seated, no loosening',
        referenceRange: null,
        severity: 'normal',
        plainLanguage: 'The new joint is in the right place and stable.',
      },
      {
        id: 'fnd_demo_10',
        label: 'Left knee',
        value: 'Mild osteoarthritis',
        referenceRange: null,
        severity: 'watch',
        plainLanguage: 'Some early wear in the other knee — worth mentioning to the surgeon.',
      },
    ],
    medicines: [],
    instructions: [
      'Show this report to the orthopaedic surgeon at the next review.',
      'No change to current activity is advised on the basis of this X-ray alone.',
    ],
    recommendedDoctorCategory: 'orthopaedic',
    questionsForDoctor: [
      'Does the mild wear in the left knee need treating now, or just watching?',
      'Are there exercises that would protect the left knee?',
    ],
    confidence: 0.85,
    generatedBy: 'ayunetz-mock-summariser/0.1',
    generatedAt: '2026-06-30T07:48:00.000Z',
  },
];
