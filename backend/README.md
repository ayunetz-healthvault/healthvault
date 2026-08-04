# Ayunetz document-processing backend

Development API for the Phase 1 privacy-first document pipeline. See
[`docs/architecture/phase-1.md`](../docs/architecture/phase-1.md) for the plan
this implements and [`progress.md`](../docs/architecture/progress.md) for what
is actually built.

> **Synthetic documents only.** This service is not an approved environment for
> health data. It is not authenticated, not hardened, and its redaction has not
> been independently validated. Do not send it a real medical document.

## Why this is a separate package

It has its own `package.json`, `node_modules` and test runner, deliberately.
The Expo app is bundled for a phone; this runs on a server. Sharing a dependency
tree would let a server-only package — and eventually the model API key that
configures one — drift into something that gets bundled into an APK. The
boundary is the point. See
[ADR-001](../docs/architecture/adr/001-ai-data-boundary.md).

Types are duplicated rather than imported across the boundary for the same
reason. The API contract in `phase-1.md` is what keeps the two in step.

## Running it

```bash
npm run backend:install
```

```bash
npm run backend:dev
```

Both are run from the repository root. From inside `backend/`, `npm install`
and `npm run dev` do the same thing.

```bash
curl http://localhost:4000/health
```

## Configuration

Copy `.env.example` to `.env`. Every value has a working default, so an empty
file starts a usable service; a variable written but left blank counts as
unset.

`SARVAM_API_KEY` is optional and **its absence selects the mock summary
provider**. Nothing needs configuring to run safely — you have to opt in to
sending text to an external provider.

That key is backend-only. It must never appear in the Expo app, in an
`EXPO_PUBLIC_*` variable, in `app.json`, or anywhere else that ships inside a
mobile bundle, where it would be trivially extractable.

## Commands

| Command             | What it does                  |
| ------------------- | ----------------------------- |
| `npm run dev`       | Watch mode on `src/server.ts` |
| `npm run build`     | `tsc` to `dist/`              |
| `npm start`         | Run the built server          |
| `npm run typecheck` | `tsc --noEmit`                |
| `npm run lint`      | ESLint, type-aware            |
| `npm test`          | Vitest                        |
| `npm run verify`    | typecheck + lint + test       |

## Logging policy

Logs carry technical metadata only: method, path without query string, status
code, duration, error class. Never document bytes, OCR text, redacted text,
prompts, model responses, names, tokens, secrets, presigned URLs or original
filenames.

`no-console` is an ESLint error here rather than a style preference — a stray
`console.log` during debugging is exactly how a page of somebody's medical
record ends up in a log file.

## Endpoints

### `POST /dev/process-document`

Multipart. Accepts **JPG, PNG and PDF**, up to ten pages per document.

A PDF is expanded before anything reads it. Where a page has a real text layer
the text is taken directly and OCR is skipped entirely — that is both faster and
exact. A scanned PDF, which is a picture in a wrapper, is rendered to an image
and goes through OCR like a photograph. Either way the pages come out as one
numbered sequence, and every page source in the summary refers to that
numbering.

### `GET /health`

```json
{ "status": "ok", "service": "ayunetz-document-processing", "version": "0.1.0" }
```

The shape is fixed. It reports nothing about configuration, dependencies or
whether a model key is present — an unauthenticated endpoint answering "is the
AI key set?" is a reconnaissance tool.
