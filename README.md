# Ayunetz Health Vault — mobile MVP

A React Native (Expo) app for people living abroad who coordinate healthcare
follow-ups for their parents in India.

The problem it addresses is specific. A lab report arrives in Chennai, gets
photographed, and lands in a WhatsApp thread. Nobody abroad can read it
properly, nobody is sure which appointment it relates to, and the follow-up
quietly slips. Ayunetz gives that report a home, a plain-language explanation,
and a due date.

> **Informational use only.** Ayunetz is not a medical device and does not
> provide medical advice, diagnosis or treatment. Document summaries are
> generated automatically and can be wrong. Always read the original document
> and speak to a qualified doctor.

---

## Status

This is an **MVP for demonstration**. It is fully navigable and fully
interactive, running on mock services and seeded data — no backend is required
to try it. Everything intended for AWS is behind a service interface with the
production shape already in place, marked `TODO(backend)`.

| Area                    | State                                                         |
| ----------------------- | ------------------------------------------------------------- |
| UI and navigation       | Complete                                                      |
| Local persistence       | Complete (AsyncStorage; encrypt before real data — see below) |
| Camera / gallery / file | Real device APIs                                              |
| Device calendar         | Real device API, behind explicit per-event confirmation       |
| Biometric / PIN lock    | Real device API                                               |
| Auth                    | **Placeholder** — local mock session, Cognito-shaped          |
| Upload                  | **Mock** — presigned-S3-shaped, no bytes leave the device     |
| Document summaries      | **Mock** — deterministic, no model is called                  |

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

```bash
npm run android
```

`.env` is optional — every value has a working default and mocks are on by
default, so the app runs demoable straight after `npm install`.

Other commands:

```bash
npm run verify
```

| Command             | What it does               |
| ------------------- | -------------------------- |
| `npm start`         | Expo dev server            |
| `npm run android`   | Build and open on Android  |
| `npm run ios`       | Build and open on iOS      |
| `npm run typecheck` | `tsc --noEmit`             |
| `npm run lint`      | ESLint                     |
| `npm run format`    | Prettier, writing in place |
| `npm test`          | Jest                       |
| `npm run verify`    | typecheck + lint + test    |

### Requirements

- Node 20+ and npm 10+
- Expo SDK 57 / React Native 0.86 / React 19
- Android Studio (Android) or Xcode (iOS) for a native build

The camera, gallery, file picker, calendar and biometrics all need a **development
build** or a real device — they do not work in a web preview. `npx expo run:android`
produces one.

### Trying the demo

Sign in with any email and a password of 8+ characters, or tap **Explore the
demo** to skip the form. The vault seeds itself with two parents (one managing
diabetes and hypertension, one recovering from knee surgery), four documents
with hand-written summaries, and a spread of overdue, due-soon and future
follow-ups.

---

## What is implemented

1. **Onboarding** — three value screens, then a medical disclaimer that must be
   ticked. Acceptance is timestamped and gates the whole app.
2. **Authentication** — sign-in and sign-up forms, backed by a mock session and
   structured exactly as Cognito will be. Biometric/PIN lock with an auto-lock
   timer, a PIN fallback, and a lockout after five failed attempts.
3. **Dashboard** — overdue alert first, then parent cards showing what is next
   and how much is on file, then the upcoming list.
4. **Parent profiles** — add, edit, view, delete. Deleting a parent takes their
   documents, summaries and follow-ups with them.
5. **Document capture** — four routes into the app: in-app multi-page scanner,
   single camera photo, phone gallery (multi-select), and a PDF/image file
   picker.
6. **Multi-page review** — reorder, remove, retake per page, plus adding more
   pages from any of the four sources before anything is uploaded.
7. **Upload** — a mock presigned-S3 flow with real progress reporting.
8. **Processing status** — upload progress and pipeline stages shown separately,
   because they fail for different reasons.
9. **Summary** — document overview, plain-language summary, findings with
   reference ranges and severity, medicines mentioned, instructions from the
   document, the relevant doctor category, and questions to ask.
10. **Follow-ups** — create (optionally pre-filled from a summary), due dates,
    status tracking, filtering by upcoming/overdue/done.
11. **Calendar** — writes to the device calendar only after a confirmation
    dialog showing the exact event, and only when the privacy toggle is on.
12. **Document timeline** — per parent, newest first.
13. **Privacy and deletion** — opt-in data sharing, data export request, delete
    a single document, wipe the local copy, or close the account behind a
    type-to-confirm gate.

---

## Architecture

### Layers

```
app/                     expo-router routes — screens only, no business logic
  _layout.tsx            providers, bootstrap, route guard
  onboarding/            welcome + medical disclaimer
  (auth)/                sign in, sign up
  lock.tsx               biometric / PIN gate
  (tabs)/                home, follow-ups, settings
  parent/                new, [id], [id]/edit
  capture/               source picker, scanner, multi-page review
  document/[id]/         summary, processing status
  follow-up/             new, [id]
  settings/              security, privacy, delete, disclaimer

src/
  components/            presentational, no store access
    ui/                  Button, Card, TextField, ChipSelect, ConfirmDialog, …
    parents|documents|followUps/
  features/              composed, feature-specific pieces (e.g. ParentForm)
  state/                 zustand stores — session, vault, capture
  services/              every side effect lives here
    api/                 API Gateway client, endpoint map, error taxonomy
    auth/                Cognito placeholder, biometric/PIN lock
    capture/             camera, gallery, file picker
    upload/              presigned-S3 upload (mocked)
    ai/                  document processing + summaries (mocked)
    calendar/            device calendar, confirmation-gated
    account/             deletion, export, local wipe
    storage/             SecureStore (secrets) and AsyncStorage (records)
  types/                 domain model + display labels
  utils/                 dates, formatting, validation, ids
  theme/                 design tokens
  mocks/                 seed data
  config/                typed environment
```

The rule that keeps this honest: **screens never call a device or network API
directly.** They call a service, and every service has a mock and a real branch
selected by `isBackendEnabled()`. That is what makes the backend swap a
service-layer change rather than a rewrite.

### State

Three zustand stores, split by lifetime rather than by entity:

- **`sessionStore`** — user, privacy settings, lock state. Persisted, minus the
  tokens (those live in SecureStore) and minus the lock state (so a cold start
  is always locked).
- **`vaultStore`** — parents, documents, summaries, follow-ups. One store rather
  than four, because almost every mutation crosses entities; a half-deleted
  vault is worse than a slightly larger reducer.
- **`captureStore`** — the in-progress capture. Deliberately **not** persisted:
  it holds `file://` URIs into the OS cache, which can be evicted, and a
  restored draft with dead image paths is worse than no draft.

Writes are local-first. The app is often opened on a weak connection right after
a phone call from India, so records are written on-device and reconciled later.

---

## Planned AWS backend (Mumbai, `ap-south-1`)

Region is not incidental: these are Indian patients' health records, and they
stay in-region.

```
                    ┌──────────────────────┐
   Mobile client    │  Amazon Cognito      │  PKCE, public client, no secret
   (this repo)  ───▶│  User Pool           │
                    └──────────┬───────────┘
                               │ ID token
                    ┌──────────▼───────────┐
                    │  API Gateway         │  JWT authorizer; `sub` is the
                    │  (regional)          │  DynamoDB partition key
                    └──────────┬───────────┘
                               │
              ┌────────────────┼─────────────────┐
              ▼                ▼                 ▼
      ┌──────────────┐  ┌─────────────┐  ┌──────────────┐
      │ Lambda: CRUD │  │ Lambda:     │  │ Lambda:      │
      │ parents,     │  │ presign S3  │  │ account      │
      │ follow-ups   │  │ uploads     │  │ deletion     │
      └──────┬───────┘  └──────┬──────┘  └──────┬───────┘
             │                 │                │
             ▼                 ▼                ▼
      ┌─────────────┐   ┌─────────────┐  ┌──────────────┐
      │  DynamoDB   │   │     S3      │  │Step Functions│
      │ single tbl  │   │ SSE-KMS,    │  │  erasure     │
      │  (KMS)      │   │ versioned   │  │  workflow    │
      └─────────────┘   └──────┬──────┘  └──────────────┘
                               │ ObjectCreated
                        ┌──────▼──────┐
                        │     SQS     │  + dead-letter queue
                        └──────┬──────┘
                               ▼
                    ┌──────────────────────┐
                    │ Lambda: doc worker   │
                    │  Textract  (OCR)     │
                    │  Comprehend Medical  │
                    │  Bedrock / LLM  ◀────┼── key from Secrets Manager
                    └──────────┬───────────┘
                               ▼
                          DynamoDB (summary item)
```

### Why the client never talks to OpenAI

An API key inside an APK is a published API key — it takes minutes to extract
from a bundle. So the mobile client has no model credential and never will. It
uploads to S3 and polls a status endpoint; the prompt, the key, and the raw
report text all stay inside the VPC. `src/services/ai/summaryService.ts`
documents this at the top and is written so the mock and the real
implementation share one interface.

### Data model (DynamoDB single table)

| Entity    | PK           | SK                            |
| --------- | ------------ | ----------------------------- |
| User      | `USER#<sub>` | `PROFILE`                     |
| Parent    | `USER#<sub>` | `PARENT#<parentId>`           |
| Document  | `USER#<sub>` | `DOC#<parentId>#<documentId>` |
| Summary   | `USER#<sub>` | `SUMMARY#<documentId>`        |
| Follow-up | `USER#<sub>` | `FUP#<dueDate>#<followUpId>`  |

The caregiver's Cognito `sub` as the partition key is what enforces tenancy —
one user physically cannot read another's items. Follow-ups sort by due date in
the key, so "what is next" is a range query rather than a scan.

### S3 layout

```
users/<sub>/parents/<parentId>/documents/<documentId>/<pageId>.jpg
```

Namespaced by user then parent so a family's data can be addressed — and
deleted — by prefix. `src/services/upload/uploadService.ts` already generates
exactly these keys.

### API contract

Every route is written down in `src/services/api/endpoints.ts` before the
backend exists, so the mocks and the eventual Lambda handlers cannot drift.

### Encryption and key management

- S3: SSE-KMS with a customer-managed key; the bucket policy rejects
  unencrypted `PUT`s. The mock already sends the
  `x-amz-server-side-encryption: aws:kms` header.
- DynamoDB: encrypted at rest with the same CMK.
- Secrets Manager: LLM keys and any third-party credentials, read only by the
  worker Lambda's execution role.
- On-device: tokens and the PIN verifier in Keychain / Android Keystore, with
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY` so they are excluded from cloud backups.

---

## Privacy and safety decisions

These were design choices, not defaults, and they are worth stating:

- **The disclaimer is a gate, not a footnote.** It must be ticked before any
  record can be stored, acceptance is timestamped, and the same wording appears
  above every generated summary.
- **Summaries are hedged in the UI.** Confidence is shown as a percentage, and
  anything below 0.7 gets an extra "parts of this were hard to read" notice. The
  generated fallback summary invents no clinical values at all.
- **Colour is never the only signal.** Every severity and status carries an icon
  and a written label — this is exactly the information that must not depend on
  seeing red.
- **The calendar needs two gates.** A standing setting (off by default) _and_ a
  per-event confirmation showing the real title, date, time and target calendar.
  Nothing is ever written in the background.
- **Appointment times are in IST.** The appointment happens in Chennai
  regardless of where the person reading the screen is, so follow-ups store
  plain calendar dates and calendar events are written with `Asia/Kolkata`.
- **Both data-sharing toggles are off.** Health data does not get a default yes.
- **Biometrics always keep a PIN fallback.** A fingerprint that stops working —
  wet hands, a cut finger — must never be the only way into medical records.

### Accessibility

Built for readers who are often 60+, sometimes reading in a second language, and
usually in a hurry:

- Body text at 17pt minimum, nothing user-facing below 14pt, line heights ≥1.4.
- Every control at least 56pt tall (64pt for primary actions) — above the 44pt
  and 48dp platform floors.
- Real, always-visible field labels rather than disappearing placeholders.
- Single-select rendered as visible chips instead of a dropdown, so no choice is
  hidden behind a tap.
- Page reordering uses explicit up/down buttons, not drag-and-drop: dragging a
  thumbnail is a precision gesture and this app gets used one-handed.
- Composed accessibility labels on cards, so a screen reader gets "who, what,
  when, and is it overdue" in one pass.
- Font scaling honoured up to 1.6×.

---

## Testing

227 tests across 16 suites, covering the parts where a bug would be expensive:

| Suite             | Focus                                                        |
| ----------------- | ------------------------------------------------------------ |
| `date`            | overdue logic, relative phrasing, age, strict ISO validation |
| `validation`      | parent and follow-up form rules                              |
| `format`          | initials, byte sizes, pluralisation, email masking           |
| `uploadService`   | object-key layout, KMS header, size limits, progress, abort  |
| `summaryService`  | pipeline stages, hedged fallback, disclaimer wording         |
| `calendarService` | event preview, IST time zone, permission and failure paths   |
| `appLock`         | PIN hashing round-trip, biometric fallback resolution        |
| `vaultStore`      | cascade deletes, selectors, overdue counting, seeding        |
| `captureStore`    | page reorder bounds, retake-in-place, readiness              |
| Component suites  | Button, ChipSelect, ConfirmDialog, PageReviewTile, cards     |

Every Expo native module is mocked in `jest.setup.ts`, so tests never touch a
device API.

```bash
npm test
```

---

## Known gaps before this handles real patient data

Tracked as `TODO(...)` markers in the code:

- **`TODO(security)` — local storage is plaintext.** AsyncStorage is readable on
  a rooted device. Move to SQLCipher (`op-sqlite`) or an app-level envelope key
  held in SecureStore. → `src/services/storage/persistence.ts`
- **`TODO(security)` — the PIN uses a single SHA-256 round.** Fine as a
  structure, not as a work factor. Move to PBKDF2/scrypt/Argon2 and add an
  attempt counter that wipes the local cache. → `src/services/auth/appLock.ts`
- **`TODO(backend)` — auth is a mock.** Replace `authService` internals with
  Cognito; no call site changes. → `src/services/auth/authService.ts`
- **`TODO(backend)` — upload is simulated.** Swap `mockUpload` for a real
  `PUT` via `expo-file-system`'s upload task so transfers survive backgrounding.
  → `src/services/upload/uploadService.ts`
- **`TODO(backend)` — summaries are canned.** Poll the real status endpoint.
  → `src/services/ai/summaryService.ts`
- **`TODO(capture)` — no edge detection.** Add on-device perspective correction
  so crooked phone shots straighten before OCR. → `app/capture/scan.tsx`
- **`TODO(legal)` — the disclaimer needs review** by counsel for Indian (DPDP
  Act) and EU/UK jurisdictions, and the copy should be versioned so an
  acceptance ties to the exact text shown. → `app/onboarding/disclaimer.tsx`
- **`TODO(i18n)` — English only.** Hindi, Tamil, Telugu and Bengali are the
  priority languages for parent-facing screens. → `src/types/labels.ts`
- No offline write queue yet: local writes happen, but there is no retry/sync
  loop to reconcile them once a backend exists.

## Secrets

`.env.example` is the only env file in the repo, and it contains no secrets by
construction — everything in it is `EXPO_PUBLIC_*`, which ships inside the
APK/IPA and must be treated as public. LLM keys, AWS credentials and Cognito
client secrets belong in AWS Secrets Manager and are read only by Lambda.
