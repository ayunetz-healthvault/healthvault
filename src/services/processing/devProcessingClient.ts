import { DocumentProcessingError } from './types';

import { config } from '@/config/env';
import type { DocumentPage, MedicalDocument, ParentProfile } from '@/types/domain';
import type { ProcessDocumentResponse, ProcessingErrorBody } from './types';

/**
 * Talks to the Phase 1 development backend.
 *
 * One request does everything: the pages go up as multipart, and the reply is a
 * finished summary. That is *not* the production shape — production is presign,
 * direct-to-S3 PUT, then poll a status endpoint (see `uploadService`) — and the
 * difference is deliberate. Phase 1 is proving the privacy pipeline, not the
 * transport, and a synchronous endpoint is far easier to reason about while the
 * redaction rules are still moving.
 *
 * ## What this sends
 *
 * The page images, and the patient details the redactor needs as ground truth:
 * name, aliases, date of birth, phone, city, known ids. Those are identifiers,
 * and sending them is the point — the backend cannot remove a name it was never
 * told. They go to *our* processing boundary and no further; nothing here
 * reaches an external model. See docs/architecture/adr/001-ai-data-boundary.md.
 *
 * ## What this never does
 *
 * Call a model, hold a model credential, or read one from the environment. The
 * app has no `SARVAM_API_KEY` and there is no code path that could use one.
 */

export interface ProcessOnBackendInput {
  document: MedicalDocument;
  parent: ParentProfile;
  /** Coarse 0–100. See the note on progress below. */
  onUploadProgress?: (percent: number) => void;
  signal?: AbortSignal;
  /** Injected in tests so the request can be inspected without a server. */
  fetchImpl?: typeof fetch;
}

const DEV_PROCESS_PATH = '/dev/process-document';

/**
 * Mirrors the backend's accepted types.
 *
 * The backend decides format on the file's bytes and refuses a mismatch, so
 * getting this wrong is a rejected upload rather than a silent problem — which
 * is exactly what happened before PDFs were supported: every PDF went up
 * labelled `image/jpeg` and was refused.
 */
export const contentTypeFor = (page: DocumentPage): string => {
  if (page.kind === 'pdf' || /\.pdf$/i.test(page.fileName)) return 'application/pdf';
  return /\.png$/i.test(page.fileName) ? 'image/png' : 'image/jpeg';
};

const buildFormData = (document: MedicalDocument, parent: ParentProfile): FormData => {
  const form = new FormData();

  document.pages.forEach((page, index) => {
    // React Native's FormData accepts this shape for a local file and streams
    // it without reading the whole image into JS memory.
    form.append('pages', {
      uri: page.uri,
      name: page.fileName || `page-${index + 1}.jpg`,
      type: contentTypeFor(page),
    } as unknown as Blob);
  });

  form.append('parentId', document.parentId);
  form.append('documentId', document.id);
  form.append('category', document.category);
  form.append('documentDate', document.documentDate);

  // Redaction ground truth — ADR-002 § "Layer 1".
  form.append('patientName', parent.fullName);
  if (parent.dateOfBirth) form.append('patientDateOfBirth', parent.dateOfBirth);
  if (parent.phone) form.append('patientPhone', parent.phone);
  if (parent.city) form.append('patientCity', parent.city);

  return form;
};

const parseErrorBody = (payload: unknown, status: number): DocumentProcessingError => {
  if (payload !== null && typeof payload === 'object' && 'code' in payload) {
    const body = payload as ProcessingErrorBody;
    return new DocumentProcessingError(body.code, body.message, {
      retryable: body.retryable,
      status,
    });
  }

  return new DocumentProcessingError('unknown', 'The document could not be processed.', { status });
};


/**
 * A budget for one processing request, composed with the caller's own signal.
 *
 * Two things can abort this call and they mean opposite things to the person
 * holding the phone: they backed out of the screen, or the server went quiet.
 * The first is not a failure and must not be reported as one; the second is,
 * and is worth retrying. `expired()` is what tells them apart afterwards, since
 * an `AbortError` carries no reason of its own.
 *
 * `AbortSignal.any` would express this in one line but is not available on
 * every runtime this app ships to, so the wiring is done by hand.
 */
const startDeadline = (
  timeoutMs: number,
  caller: AbortSignal | undefined,
): { signal: AbortSignal; expired: () => boolean; release: () => void } => {
  const controller = new AbortController();
  let expired = false;

  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, timeoutMs);

  const onCallerAbort = (): void => controller.abort();

  if (caller !== undefined) {
    if (caller.aborted) {
      controller.abort();
    } else {
      caller.addEventListener('abort', onCallerAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    expired: () => expired,
    release: () => {
      clearTimeout(timer);
      caller?.removeEventListener('abort', onCallerAbort);
    },
  };
};

/**
 * Why the request ended, in the order that matters to the caregiver.
 *
 * A cancel is checked first: if they left the screen we say so, even if the
 * timer happened to fire in the same tick. Only then is a genuine timeout
 * reported — retryable, because the pipeline may simply have been slow.
 */
const failureFor = (
  cause: unknown,
  caller: AbortSignal | undefined,
  deadline: { expired: () => boolean },
): DocumentProcessingError => {
  if (caller?.aborted === true) {
    return new DocumentProcessingError('processing_timeout', 'Processing was cancelled.', { cause });
  }

  if (deadline.expired()) {
    return new DocumentProcessingError(
      'processing_timeout',
      'The processing service did not reply in time.',
      { retryable: true, cause },
    );
  }

  return new DocumentProcessingError('upload_failed', 'Could not reach the processing service.', {
    retryable: true,
    cause,
  });
};

export const processDocumentOnBackend = async (
  input: ProcessOnBackendInput,
): Promise<ProcessDocumentResponse> => {
  const { document, parent, onUploadProgress, signal, fetchImpl = fetch } = input;

  if (document.pages.length === 0) {
    throw new DocumentProcessingError('invalid_file', 'There are no pages to send.');
  }

  const url = `${config.api.baseUrl.replace(/\/$/, '')}${DEV_PROCESS_PATH}`;

  /**
   * Progress is coarse, and honestly so.
   *
   * `fetch` reports no upload progress, so this reports "started" and then
   * "sent" rather than inventing a smooth bar. Real byte progress needs
   * `expo-file-system`'s upload task, which is the existing `TODO(backend)` on
   * `uploadService` — a fake animation here would tell the caregiver on a hotel
   * wifi that something is happening when it may have stalled.
   */
  onUploadProgress?.(5);

  const deadline = startDeadline(config.api.processingTimeoutMs, signal);

  try {
    let response: Response;

    try {
      response = await fetchImpl(url, {
        method: 'POST',
        body: buildFormData(document, parent),
        // Content-Type is deliberately unset: the runtime fills in the multipart
        // boundary, and setting it by hand produces a body the server cannot parse.
        headers: { Accept: 'application/json' },
        signal: deadline.signal,
      });
    } catch (cause) {
      throw failureFor(cause, signal, deadline);
    }

    onUploadProgress?.(100);

    // The body is read while the deadline is still live: a server that sends
    // headers and then stops would otherwise hang here instead of in `fetch`,
    // which is the same stranded screen by a different route.
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      if (signal?.aborted === true || deadline.expired()) {
        throw failureFor(cause, signal, deadline);
      }
      payload = null;
    }

    if (!response.ok) {
      throw parseErrorBody(payload, response.status);
    }

    if (payload === null || typeof payload !== 'object') {
      throw new DocumentProcessingError(
        'validation_failed',
        'The processing reply was unreadable.',
        { status: response.status },
      );
    }

    return payload as ProcessDocumentResponse;
  } finally {
    deadline.release();
  }
};
