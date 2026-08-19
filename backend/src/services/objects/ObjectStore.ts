import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { StackConfig } from '../../config/stack.js';

/**
 * Where original document pages live.
 *
 * The port exists so the rest of the system never names S3, and so the object
 * key layout is decided in exactly one place. The implementation is a single S3
 * client: MinIO speaks the same protocol, so `local` and `aws` differ only by
 * the endpoint and credentials in `StackConfig` — see `config/stack.ts`.
 *
 * ## Why presigned PUT rather than uploading through this service
 *
 * The phone uploads directly to the bucket. Document bytes never transit our
 * compute, which removes an entire class of accident: no scan of somebody's
 * prescription sits in a request log, a heap dump, or a proxy cache. It also
 * means the client never holds a long-lived credential — only a URL that works
 * for one key, one method, and a few minutes.
 */
export interface PageLocation {
  /** Tenant, from the verified token subject. Never from the request body. */
  readonly ownerId: string;
  readonly documentId: string;
  /** 1-based, matching how pages are numbered everywhere else. */
  readonly page: number;
}

export interface PresignedUpload {
  readonly key: string;
  readonly url: string;
  readonly expiresInSeconds: number;
  /** Headers the client must send for the signature to match. */
  readonly headers: Record<string, string>;
}

export interface ObjectStore {
  keyFor(location: PageLocation): string;
  presignUpload(location: PageLocation, contentType: string): Promise<PresignedUpload>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

/**
 * Object keys.
 *
 * Owner first, so a prefix is a tenant. That makes "delete everything belonging
 * to this account" a prefix operation rather than a scan, which is what makes
 * the erasure path in P2-16 tractable — and it is the shape an IAM policy needs
 * if object-level isolation is ever enforced there too.
 *
 * The key contains no name, no date of birth and no filename from the device.
 * A bucket listing is metadata, and metadata about medical records leaks.
 */
export const pageKey = ({ ownerId, documentId, page }: PageLocation): string =>
  `owners/${ownerId}/documents/${documentId}/pages/${String(page).padStart(3, '0')}`;

const toBytes = async (body: unknown): Promise<Uint8Array> => {
  if (body instanceof Uint8Array) return body;

  if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
    return new Uint8Array(Buffer.concat(chunks));
  }

  if (typeof (body as { transformToByteArray?: unknown })?.transformToByteArray === 'function') {
    return (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
  }

  throw new TypeError('Unrecognised S3 body type');
};

export const createObjectStore = (config: StackConfig): ObjectStore => {
  const client = new S3Client(config.clients.objects);
  const Bucket = config.documentsBucket;

  return {
    keyFor: pageKey,

    async presignUpload(location, contentType) {
      const key = pageKey(location);

      const url = await getSignedUrl(
        client,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType }),
        {
          expiresIn: config.presignTtlSeconds,
          /**
           * Without this the content type is sent but not *signed*, so the URL
           * would accept a body of any type — the signature only covers `host`
           * by default. Naming it here puts it in `SignedHeaders`, so an upload
           * that claims a different type fails the signature check at the
           * store.
           *
           * Defence in depth rather than the primary control: the pipeline
           * still decides format on the file's bytes, because a client that
           * labels a PDF as a JPEG is a bug and a client that lies about it is
           * an attacker.
           */
          signableHeaders: new Set(['content-type']),
        },
      );

      return {
        key,
        url,
        expiresInSeconds: config.presignTtlSeconds,
        // Signed into the URL, so a client that sends a different type gets a
        // rejection from the store rather than storing a mislabelled object.
        headers: { 'Content-Type': contentType },
      };
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async get(key) {
      const response = await client.send(new GetObjectCommand({ Bucket, Key: key }));
      return toBytes(response.Body);
    },

    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return true;
      } catch (error) {
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode;
        if (status === 404) return false;
        throw error;
      }
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
};
