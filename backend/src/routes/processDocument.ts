import { parseFields, toPatientProfile } from '../schemas/processDocument.js';
import { validatePage, validatePageCount } from '../services/upload/FileValidator.js';
import { TemporaryFileManager } from '../services/upload/TemporaryFileManager.js';
import {
  ProcessingError,
  type DocumentProcessor,
  type ProcessDocumentResponse,
  type TemporaryPage,
} from '../types/processing.js';

import type { FastifyPluginAsync } from 'fastify';

/**
 * `POST /dev/process-document`
 *
 * Development entry point for the Phase 1 pipeline. Its job is narrow: get the
 * pages onto disk safely, hand them to the processor, and guarantee they are
 * gone afterwards whatever happens. Everything clinical belongs downstream.
 *
 * There is no authentication here. This service accepts synthetic documents in
 * a controlled development environment and is not deployed anywhere a real
 * document could reach it — see backend/README.md.
 */

export interface ProcessDocumentRoutesOptions {
  processor: DocumentProcessor;
}

/** Field names that carry a file. Anything else is treated as a text field. */
const PAGES_FIELD = 'pages';

export const processDocumentRoutes: FastifyPluginAsync<ProcessDocumentRoutesOptions> = async (
  app,
  options,
) => {
  const { processor } = options;

  app.post('/dev/process-document', async (request, reply): Promise<ProcessDocumentResponse> => {
    if (!request.isMultipart()) {
      throw new ProcessingError('invalid_file', 'The request must be multipart/form-data.');
    }

    const config = app.config;
    const temporaryFiles = new TemporaryFileManager(config.PROCESSING_TEMP_DIR);
    await temporaryFiles.prepare();

    try {
      const fields: Record<string, string | string[]> = {};
      const pages: TemporaryPage[] = [];

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname !== PAGES_FIELD && part.fieldname !== `${PAGES_FIELD}[]`) {
            throw new ProcessingError(
              'invalid_file',
              `Unexpected file field. Pages must be sent as "${PAGES_FIELD}".`,
            );
          }

          // Checked before reading the next file, so an oversized request is
          // refused rather than buffered.
          validatePageCount(pages.length + 1, { maxPages: config.MAX_DOCUMENT_PAGES });

          const pageNumber = pages.length + 1;
          let buffer: Buffer;

          try {
            buffer = await part.toBuffer();
          } catch (cause) {
            // The stream hit `limits.fileSize`. Report the limit, not the cause,
            // whose message can quote the filename.
            throw new ProcessingError(
              'invalid_file',
              `Page ${pageNumber} is larger than the ${Math.floor(
                config.MAX_PAGE_BYTES / (1024 * 1024),
              )} MB limit.`,
              { details: { page: pageNumber }, cause },
            );
          }

          const mimeType = validatePage(buffer, {
            page: pageNumber,
            declaredMimeType: part.mimetype,
            maxBytes: config.MAX_PAGE_BYTES,
            truncated: part.file.truncated,
          });

          pages.push(await temporaryFiles.writePage(pageNumber, buffer, mimeType));
          continue;
        }

        const name = part.fieldname.replace(/\[\]$/, '');
        const value = String(part.value);
        const existing = fields[name];

        if (existing === undefined) {
          fields[name] = value;
        } else if (Array.isArray(existing)) {
          existing.push(value);
        } else {
          fields[name] = [existing, value];
        }
      }

      validatePageCount(pages.length, { maxPages: config.MAX_DOCUMENT_PAGES });

      const parsed = parseFields(fields);

      const result = await processor.process({
        documentId: parsed.documentId,
        parentId: parsed.parentId,
        category: parsed.category,
        ...(parsed.documentDate === undefined ? {} : { documentDate: parsed.documentDate }),
        patient: toPatientProfile(parsed),
        pages,
        workingDirectory: temporaryFiles.directory,
      });

      reply.code(200);
      return result;
    } finally {
      // Unconditional. Success, validation failure, OCR crash, privacy stop,
      // client disconnect — the pages go either way. `cleanup()` does not throw,
      // so it cannot mask whatever is propagating.
      await temporaryFiles.cleanup();
    }
  });
};
