# Verified source baseline

Review date: 8 September 2026. Repository: `ayunetz-healthvault/healthvault`. Reviewed main commit: `ecb38d284bacc7989aa7fe20470fa6582dc60a90`.

This is source inspection, not proof that a device build, live Sarvam call or AWS deployment has passed. Historical test counts in `docs/architecture/progress.md` belong to that author's recorded runs and were not rerun during this handoff. No AGENTS.md or CLAUDE.md was found in the reviewed tree; inspect again before implementation.

| Capability | Evidence in repository | Status / implementation implication |
| --- | --- | --- |
| Caregiver home | `app/(tabs)/index.tsx` | Parent cards, overdue and upcoming follow-ups, capture actions exist. Reuse flows. |
| Parent profile | `app/parent/[id]/index.tsx`, `src/types/domain.ts` | Personal details, conditions, allergies, notes and document timeline exist inside a caregiver vault. No independent parent principal or access-grant model found. |
| Capture | `src/services/capture/captureService.ts`, `app/capture/` | Native photo, gallery and PDF selection. Picked files are copied into cache; no demonstrated durable encrypted-original lifecycle. |
| Summary UI | `app/document/[id]/index.tsx`, `src/components/documents/` | Findings, medicines, questions, source references, uncertainty and follow-up display exist. Full original-view/correction/approval experience needs extending. |
| Phone records | `src/state/vaultStore.ts`, `src/services/storage/persistence.ts` | Zustand persists records with AsyncStorage. Encryption and sync are TODOs. Do not mistake app lock for record encryption. |
| Mobile auth | `src/services/auth/authService.ts` | Mock sessions; backend-enabled sign-in/sign-up throw not-configured errors. Refresh/revocation unfinished. |
| Backend auth | `backend/src/app.ts`, `routes/authentication.ts`, `services/identity/TokenVerifier.ts` | Verified token caller and route guards exist. Local issuer is development-only. Real Cognito flow is unproven. |
| Storage/API | `backend/src/routes/v1/{parents,documents}.ts`, `services/{objects,records,queue}/` | Parent/document API, presigned uploads, completion checks, queue submission, processing/summary reads exist. Keep these adapters. |
| Tenant schema | `backend/src/services/records/keys.ts` | `USER#ownerId` partitions; document keys are `DOC#documentId`, with a parent GSI. Source differs from the older phase-2 suggested schema. Shared parent ownership needs an ADR/migration. |
| Mobile pipeline | `src/services/processing/documentPipeline.ts`, `devProcessingClient.ts` | Backend mode uses a synchronous development processing request, not the queued `/v1` lifecycle. |
| OCR and AI | `backend/src/services/processing/DocumentProcessingOrchestrator.ts`, `backend/src/app.ts` | Server Tesseract, PDF text extraction, redaction, leakage checks, summary/source validation exist. Keep the boundary. |
| Sarvam | `backend/src/services/summarisation/SarvamSummaryProvider.ts`, `config/env.ts` | Provider code exists; absence of key selects mock. Provider file says real API behavior has not been verified. |
| Worker | `backend/src/services/queue/JobQueue.ts`, latest section of architecture `progress.md` | Queue adapter exists, but no consumer entrypoint found; queued documents remain queued on this path. |
| Calendar | `src/services/calendar/calendarService.ts` | Device calendar write implementation exists, with confirmation and India appointment timezone. Not a background family calendar sync service. |
| Account operations | `src/services/account/accountService.ts`, backend route registration | Client contracts for export/deletion exist; corresponding backend endpoints are not implemented in the reviewed source. |
| Real deployment | `backend/src/config/stack.ts`, `backend/README.md`, architecture ADR-003 | Local MinIO/DynamoDB Local/ElasticMQ foundations exist. AWS runtime, IAM/KMS, residency and recovery need independent verification. |

## Corrections to earlier conversation assumptions

- The exact repository link works. Empty discovery results did not prove missing GitHub authorization.
- The app already chose DynamoDB; introducing PostgreSQL is unnecessary for this backlog.
- OCR is currently on the backend. Phone OCR was an option discussed, not an agreed replacement. Preserve Tesseract until measured quality or deployment requirements justify a provider change; phase-2 already discusses Textract.
- A request returning a summary from `/dev/process-document` does not prove the durable cloud upload/queue path works.
- Redaction is risk reduction, not verified anonymisation or a blanket legal exemption.
- The copied visual reference predates this source review. Its “GitHub not verified” dialog text is historical; this document supersedes that note. Its simulated sharing, medication schedule and clinical-looking sample data are not implementation or clinical requirements.
