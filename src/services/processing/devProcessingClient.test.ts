import { contentTypeFor, processDocumentOnBackend } from './devProcessingClient';
import { DocumentProcessingError } from './types';

import { MOCK_DOCUMENTS } from '@/mocks/documents';
import { MOCK_PARENTS } from '@/mocks/parents';
import type { DocumentPage, MedicalDocument, ParentProfile } from '@/types/domain';

const document = MOCK_DOCUMENTS[0] as MedicalDocument;
const parent = MOCK_PARENTS[0] as ParentProfile;

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

/** Reads the fields out of a FormData the client built. */
const fieldsOf = (form: FormData): Record<string, unknown> => {
  const entries: Record<string, unknown> = {};
  // React Native's FormData exposes `_parts`; the DOM one is iterable.
  const parts = (form as unknown as { _parts?: [string, unknown][] })._parts;

  if (parts) {
    for (const [name, value] of parts) entries[name] = value;
    return entries;
  }

  for (const [name, value] of form as unknown as Iterable<[string, unknown]>) {
    entries[name] = value;
  }
  return entries;
};

const successBody = {
  documentId: 'doc_hashed',
  processingStatus: 'ready',
  summary: { overview: 'ok' },
  privacy: { redactionApplied: true },
};

describe('processDocumentOnBackend', () => {
  it('posts multipart to the development endpoint', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(successBody)) as unknown as typeof fetch;

    await processDocumentOnBackend({ document, parent, fetchImpl });

    const [url, init] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/dev/process-document');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('does not set Content-Type, so the runtime can add the boundary', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(successBody)) as unknown as typeof fetch;

    await processDocumentOnBackend({ document, parent, fetchImpl });

    const [, init] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    // Setting it by hand produces a body the server cannot parse.
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type');
  });

  it('sends the patient details the redactor needs as ground truth', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(successBody)) as unknown as typeof fetch;

    await processDocumentOnBackend({ document, parent, fetchImpl });

    const [, init] = (fetchImpl as jest.Mock).mock.calls[0] as [string, RequestInit];
    const fields = fieldsOf(init.body as FormData);

    // These are identifiers, and sending them is the point: the backend cannot
    // remove a name it was never told. They go no further than our own
    // processing boundary.
    expect(fields.patientName).toBe(parent.fullName);
    expect(fields.patientPhone).toBe(parent.phone);
    expect(fields.patientCity).toBe(parent.city);
    expect(fields.patientDateOfBirth).toBe(parent.dateOfBirth);
    expect(fields.documentId).toBe(document.id);
    expect(fields.category).toBe(document.category);
  });

  it('refuses a document with no pages before making a request', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;

    await expect(
      processDocumentOnBackend({ document: { ...document, pages: [] }, parent, fetchImpl }),
    ).rejects.toMatchObject({ code: 'invalid_file' });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports progress at the start and the end, without inventing a curve', async () => {
    const percents: number[] = [];
    const fetchImpl = jest.fn(async () => jsonResponse(successBody)) as unknown as typeof fetch;

    await processDocumentOnBackend({
      document,
      parent,
      fetchImpl,
      onUploadProgress: (percent) => percents.push(percent),
    });

    expect(percents).toEqual([5, 100]);
  });

  describe('failures', () => {
    it('preserves a typed backend failure, including a privacy stop', async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse(
          {
            code: 'privacy_failed',
            message: 'The document could not be processed safely.',
            retryable: false,
            details: { possiblePiiRemaining: true, categories: ['possible_address'] },
          },
          422,
        ),
      ) as unknown as typeof fetch;

      await expect(processDocumentOnBackend({ document, parent, fetchImpl })).rejects.toMatchObject(
        {
          code: 'privacy_failed',
          retryable: false,
        },
      );
    });

    it('shows the caregiver safe copy for a privacy stop, naming nothing', async () => {
      const error = new DocumentProcessingError('privacy_failed', 'internal detail');

      expect(error.userMessage).toContain('could not be processed safely');
      expect(error.userMessage).not.toContain('internal detail');
      // It points at the thing that is still available and still authoritative.
      expect(error.userMessage).toContain('original');
    });

    it('turns an unreachable server into a retryable upload failure', async () => {
      const fetchImpl = jest.fn(async () => {
        throw new TypeError('Network request failed');
      }) as unknown as typeof fetch;

      await expect(processDocumentOnBackend({ document, parent, fetchImpl })).rejects.toMatchObject(
        {
          code: 'upload_failed',
          retryable: true,
        },
      );
    });

    it('reports a cancellation as such rather than as a network problem', async () => {
      const controller = new AbortController();
      controller.abort();
      const fetchImpl = jest.fn(async () => {
        throw new Error('Aborted');
      }) as unknown as typeof fetch;

      await expect(
        processDocumentOnBackend({ document, parent, fetchImpl, signal: controller.signal }),
      ).rejects.toMatchObject({ code: 'processing_timeout' });
    });

    it('rejects a reply that is not an object', async () => {
      const fetchImpl = jest.fn(async () => jsonResponse('not json')) as unknown as typeof fetch;

      await expect(processDocumentOnBackend({ document, parent, fetchImpl })).rejects.toMatchObject(
        {
          code: 'validation_failed',
        },
      );
    });

    it('falls back to a generic failure when the body has no code', async () => {
      const fetchImpl = jest.fn(async () =>
        jsonResponse({ error: 'nginx said no' }, 502),
      ) as unknown as typeof fetch;

      await expect(processDocumentOnBackend({ document, parent, fetchImpl })).rejects.toMatchObject(
        {
          code: 'unknown',
        },
      );
    });
  });
});

describe('file types on the wire', () => {
  // Asserted on the mapping function rather than through FormData: the test
  // environment provides the DOM FormData, which stringifies the file
  // descriptor React Native understands, so the type is not observable there.
  const page = (fileName: string, kind: DocumentPage['kind']): DocumentPage => ({
    ...document.pages[0]!,
    fileName,
    kind,
  });

  it('labels a PDF as a PDF', () => {
    // Before PDFs were supported every one went up as image/jpeg, and the
    // backend refused it on the byte-versus-claim mismatch.
    expect(contentTypeFor(page('discharge-summary.pdf', 'pdf'))).toBe('application/pdf');
  });

  it('trusts the extension when the kind was recorded loosely', () => {
    expect(contentTypeFor(page('scan.pdf', 'image'))).toBe('application/pdf');
  });

  it.each([
    ['page.png', 'image/png'],
    ['page.PNG', 'image/png'],
    ['page.jpg', 'image/jpeg'],
    ['photo', 'image/jpeg'],
  ])('labels %s as %s', (fileName, expected) => {
    expect(contentTypeFor(page(fileName, 'image'))).toBe(expected);
  });

  it('sends a PDF document without complaint', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(successBody)) as unknown as typeof fetch;

    await expect(
      processDocumentOnBackend({
        document: { ...document, pages: [page('report.pdf', 'pdf')] },
        parent,
        fetchImpl,
      }),
    ).resolves.toBeDefined();
  });
});
