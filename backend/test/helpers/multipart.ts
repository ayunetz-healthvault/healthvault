import { randomUUID } from 'node:crypto';

/**
 * Minimal multipart/form-data builder for `app.inject()`.
 *
 * Hand-rolled rather than pulled from a library so the tests control the exact
 * bytes on the wire — including the deliberately wrong content types and the
 * filenames that must never come back in a response.
 */

export interface MultipartFilePart {
  name: string;
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MultipartFieldPart {
  name: string;
  value: string;
}

export interface MultipartRequest {
  headers: Record<string, string>;
  payload: Buffer;
}

export const buildMultipart = (
  fields: MultipartFieldPart[],
  files: MultipartFilePart[] = [],
): MultipartRequest => {
  const boundary = `----ayunetztest${randomUUID().replace(/-/g, '')}`;
  const chunks: Buffer[] = [];

  for (const field of fields) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`,
        'utf8',
      ),
    );
  }

  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.content,
      Buffer.from('\r\n', 'utf8'),
    );
  }

  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));

  const payload = Buffer.concat(chunks);

  return {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(payload.length),
    },
    payload,
  };
};
