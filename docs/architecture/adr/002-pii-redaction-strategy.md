# ADR-002 — PII Redaction and Leakage Strategy

- **Status:** Accepted for architecture planning
- **Date:** 2026-08-02
- **Owners:** Ayunetz Health Vault
- **Decision type:** Privacy and document-processing architecture

## Context

Medical documents are semi-structured and often include identifiers in headers, footers, labels, tables, stamps and free text.

A single generic regex pass is not sufficient because:

- names have many formats
- Indian identifiers have specific patterns
- addresses span multiple lines
- OCR introduces spacing and character errors
- report dates must be preserved while dates of birth may need removal
- medication dosages and clinical values must not be destroyed
- multilingual documents may not be supported equally by generic PII tools

## Decision

Ayunetz will use a layered redaction strategy followed by an independent leakage gate.

```text
OCR text
  -> normalisation
  -> known-value redaction
  -> deterministic pattern redaction
  -> labelled-region redaction
  -> optional supplementary entity detection
  -> independent leakage check
  -> external AI only when safe
```

The redaction engine and leakage gate must be separate components. The leakage gate must not simply call the same method again.

## Layer 1 — Known-value redaction

The application supplies known profile values where available:

- patient full name
- name aliases
- initials
- date of birth
- phone number
- city
- address
- known patient IDs
- known insurance IDs

Known values are the strongest redaction signal.

Matching should account for:

- case differences
- repeated whitespace
- punctuation
- common title prefixes
- first-name/last-name order
- initials
- OCR spacing errors where safely possible

The system must avoid aggressive fuzzy matching that could remove clinical terms.

## Layer 2 — Deterministic pattern redaction

Patterns cover:

- email
- Indian and international phone numbers
- Aadhaar
- PAN
- passport
- patient ID
- medical-record number
- hospital registration number
- insurance/member identifier
- identifier-bearing URLs
- long account-like sequences

Pattern implementations must be tested with:

- valid examples
- invalid near matches
- OCR spacing
- punctuation
- values adjacent to labels
- clinical values that must not be redacted

## Layer 3 — Labelled-region redaction

Some values are identifiable by labels rather than reliable patterns.

Examples:

```text
Patient Name:
Name:
Address:
Residence:
Patient Address:
Contact:
Mobile:
DOB:
Date of Birth:
UHID:
MRN:
Patient ID:
Registration No:
Member ID:
Insurance No:
```

The redactor may remove:

- the labelled value
- the remainder of the line
- a bounded number of subsequent address lines

Address redaction must stop at a clear new clinical section or field.

## Layer 4 — Supplementary entity detection

A managed or open-source named-entity detector may be used as a supplementary layer only after evaluation.

It is not the sole source of protection because:

- language coverage may be incomplete
- health-document formats differ
- false negatives are unacceptable
- regional availability may change
- OCR errors reduce entity-recognition quality

Before production use, document:

- supported languages
- target region
- data handling
- false-negative test results
- false-positive test results
- operational cost

## Typed placeholders

Use stable typed placeholders:

```text
[PATIENT_NAME]
[PERSON_NAME]
[ADDRESS]
[PHONE]
[EMAIL]
[DATE_OF_BIRTH]
[AADHAAR]
[PAN]
[PASSPORT]
[PATIENT_ID]
[INSURANCE_ID]
[REDACTED_IDENTIFIER]
```

Typed placeholders retain enough context for summarisation without exposing values.

Do not include hashes or encrypted forms of removed values in the external prompt.

## Clinical information to preserve

The redactor must preserve where possible:

- report date
- sample date
- test date
- appointment date
- follow-up date
- test name
- result value
- unit
- reference range
- abnormal marker
- medication name
- dosage
- frequency
- route
- duration
- written instruction
- doctor speciality
- document category

## Dates

Date handling is context aware.

Redact when associated with:

```text
DOB
Date of Birth
Born
Age and DOB identity block
```

Preserve when associated with:

```text
Report Date
Sample Date
Collection Date
Test Date
Discharge Date
Review Date
Follow-up Date
Appointment Date
```

Ambiguous dates may trigger manual review rather than automatic removal or retention.

## Names of clinicians and facilities

The minimum privacy requirement is removal of patient and caregiver identity.

Clinician and facility names may also contribute to re-identification. The product must decide before production whether to:

- redact all clinician and facility names
- retain doctor speciality but remove names
- retain facility only under an approved policy
- send no facility information externally

The default privacy-first position is:

- remove individual clinician names
- remove specific facility names
- preserve doctor speciality and document type

## Independent leakage gate

After redaction, a separate component checks for likely residual identifiers.

Checks include:

- supplied patient name or alias
- email
- phone
- Aadhaar
- PAN
- passport
- long identifier strings
- address-labelled text
- DOB-labelled text
- unredacted known IDs
- suspicious identifier-bearing URLs

The leakage result contains categories only:

```ts
type LeakageCheckResult =
  | { safe: true; categories: [] }
  | { safe: false; categories: string[] };
```

It must not return or log the suspected value.

## Fail-closed behaviour

When the gate reports unsafe:

- do not call Sarvam
- return `privacy_failed`
- delete temporary files
- store only safe technical metadata
- allow the user to retry with a clearer or manually cropped document
- optionally move to a tightly controlled manual-review state in Phase 2

## Redaction metrics

Record non-sensitive metrics:

- redaction pipeline version
- count by category
- number of pages
- privacy gate pass/fail
- duration
- OCR confidence range

Do not record removed values.

Example:

```json
{
  "pipelineVersion": "redaction-v1",
  "counts": {
    "patientName": 1,
    "address": 1,
    "phone": 1,
    "patientId": 1
  },
  "possiblePiiRemaining": false
}
```

## Source snippets

If the UI displays source snippets:

- snippets must be generated from redacted text
- snippets must be short
- snippets must pass the leakage gate
- snippets must be optional
- original text remains available only through the document view

## Testing strategy

Use synthetic fixtures only.

Required test categories:

1. exact patient name
2. case-insensitive patient name
3. aliases
4. initials
5. phone
6. email
7. Aadhaar
8. PAN
9. passport
10. patient ID
11. MRN
12. registration number
13. insurance ID
14. single-line address
15. multi-line address
16. DOB label
17. report date preserved
18. lab value preserved
19. unit preserved
20. reference range preserved
21. medicine preserved
22. dosage preserved
23. frequency preserved
24. leakage failure blocks provider
25. suspected value absent from response
26. suspected value absent from logs
27. temporary file cleanup after privacy failure

## Evaluation set

Before real data is permitted, create an approved synthetic evaluation set covering:

- common Indian lab-report layouts
- prescriptions
- discharge summaries
- diagnostic imaging reports
- printed and scanned documents
- low-resolution images
- skewed images
- multi-page reports
- English
- representative Indian-language documents planned for support
- mixed-language reports
- OCR spacing errors

Track:

- direct-identifier recall
- false-negative rate
- false-positive rate
- clinical-value preservation
- latency
- percentage sent to manual review

## Consequences

### Positive

- multiple independent controls
- known patient context improves recall
- typed placeholders preserve document structure
- privacy failures are testable
- provider requests can be inspected using synthetic fixtures

### Negative

- false positives may remove useful clinical content
- false negatives remain possible
- OCR errors reduce accuracy
- multilingual support requires separate evaluation
- manual review may be necessary
- redaction rules require ongoing maintenance

## Future decisions

The following require separate approval:

- manual review by support personnel
- retention of clinician names
- retention of hospital names
- redaction of rare-condition descriptions
- on-device redaction
- external vision-model processing
- multilingual entity-detection provider
