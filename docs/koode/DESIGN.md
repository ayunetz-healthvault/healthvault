# Approved display and native adaptation

The user explicitly liked the display at `design-reference/index.html`. Preserve its visual identity and task hierarchy while implementing native Expo screens. The reference is not a requirement to embed a website in a WebView.

## Visual language

Reuse and extend `src/theme/tokens.ts`, `src/components/ui/`, parent/document/follow-up cards and native navigation.

| Token / principle | Reference | Native interpretation |
| --- | --- | --- |
| Primary green | `#145b48` | Main action, selected navigation, key emphasis |
| Text | `#153c31` | High-contrast primary text |
| Background | `#fffcf6` | Warm light background |
| Peach | `#fce6c9` | Appointment / review context, always with explicit text labels |
| Soft green | `#e8ede0` | Supporting surfaces and quiet status |
| Muted text | `#626d65` | Secondary text only, verify contrast |
| Cards | 16–18 px corners | Spacious, restrained grouping |
| Body | 16 px main user, 18 px parent | Support native text scaling; no clipped text at 200% |
| Parent primary action | About 58 px minimum height | At least 48 px effective targets across supported controls |
| Typography | Reference uses Nunito | Reuse existing typography when appropriate; avoid adding dependencies solely for cosmetic fidelity |

Desktop two-phone frames and the “Compare views” switch are a design-review surface only. The production app selects experience from authenticated identity and access; never ship a freely switchable identity toggle. Layout must fit a small phone without horizontal scrolling, use safe areas and accessible contrast, and support screen readers. English is the initial scope; externalise strings for later languages. Do not promise Malayalam OCR or a translated UI until implemented and tested.

## Main user experience

Navigation: Home / Family / Calendar / To-do.

Home order: greeting; family members; items needing attention; upcoming visits; add document / to-do shortcuts. Retain an overdue item above lower-priority content when warranted by actual data. Family cards distinguish document review pending, upcoming visits, sync freshness and sharing paused. “Not recorded” must not be presented as “medicine missed” or as a medical risk assessment.

Opening a parent shows record context persistently. Reuse conditions, allergies, doctor contact, source-linked documents and follow-ups already present. Show author and time of each contribution. A helper never silently switches the patient while adding data.

## Individual parent experience

Navigation: Today / My health / Calendar / Family.

Today prioritises the next confirmed action. If a confirmed treatment schedule exists: show due medicine and Taken / Missed actions, with undo. If none exists: show the next appointment or add-document action; never display an invented medication to fill the card. Then show appointment preparation, document capture, a short symptom note, and the family helper.

“My health” gives documents, confirmed medicines, notes and tasks without overwhelming the Today screen. Family shows named helpers, exact permissions, grant/revocation controls, and any pending invitation. Parents can act for themselves; helpers contribute with explicit attribution.

## Essential connected flows

1. Choose patient → photograph/select report → check pages → upload status → processing status → review original and AI draft → save correction/approval → propose, then separately confirm follow-up.
2. Parent records a scheduled dose → server acknowledges → authorized caregiver sees the same event and author; offline writes say pending sync.
3. Parent or helper adds symptom/question → upcoming visit summary includes it as a user observation → after-visit task has assignee, due date and note/source.
4. Parent revokes helper → backend denies subsequent access and work; cached data is purged at next online authorization check. Previously exported copies cannot be recalled, and offline revocation is not instantaneous.

## States that must be designed

First parent / first document; no treatment; no upcoming appointment; no matching filter results; permissions denied; offline with last-sync time; pending upload; processing in progress; unreadable report; AI unavailable; review needed; conflict; failed save; expired session; sharing revoked. Distinguish “saved on phone” from “saved to shared record”. Use text and icons rather than color alone.

## Reference limitations to fix in production

- All dates, people, medicines and counts are fictional examples; calculate from real permitted records.
- Demo actions update shared browser memory only; no real auth, persistence, upload, AI or notifications occur.
- The reference has simplified review, calendar and sharing behavior. Stories define the complete behavior, including per-patient authorization and offline state.
- Do not call a parent “healthy”, “safe” or “all clear” based on missing data or completed tasks.
- Preserve the original file and distinguish AI output, user edits and clinician source text.
- Prototype controls that only explain a simulation must become real flows or be omitted from production.

## Design acceptance

For changed screens, compare with this reference on compact and larger phones, show the flow with synthetic data, and capture evidence at normal and enlarged text. Test actual navigation, screen-reader labels and keyboard behavior where relevant. Do not treat matching colors alone as completion.
