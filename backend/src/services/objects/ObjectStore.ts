import { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
  /**
   * Whose record this page belongs to.
   *
   * Not the account that uploaded it. A page belongs to the patient, so that
   * revoking a helper moves no bytes, and so "delete this person's record" is
   * one prefix rather than a hunt through every account that ever contributed
   * to it. The caller reaches this id only by holding a grant — see ADR-005.
   */
  readonly patientId: string;
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
  /**
   * A short-lived URL for *reading* one page.
   *
   * So a person reviewing a summary can look at what the clinician actually
   * wrote. Deliberately shorter-lived than an upload URL: reading is a glance,
   * uploading is a transfer over a bad connection, and this is a bearer token
   * that keeps working after the grant behind it is withdrawn.
   */
  presignDownload(location: PageLocation, expiresInSeconds: number): Promise<string>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  /** Every object key for one patient's record. */
  prefixFor(patientId: string): string;
  /**
   * Deletes everything under a prefix, however many pages of listing it takes.
   *
   * Erasure needs this and per-key deletion cannot do it. Keys derived from the
   * table's rows only cover pages the table still knows about: bytes uploaded
   * through a URL signed before the deletion began arrive with no row at all,
   * and a document row removed by an earlier partial deletion leaves its pages
   * unreachable and undeletable. The prefix is the record, so the prefix is
   * what gets swept.
   */
  deletePrefix(prefix: string): Promise<{ objects: number }>;
}

/**
 * Object keys.
 *
 * **Patient first**, so a prefix is one person's record. That makes "delete
 * everything about this person" a prefix operation rather than a scan, which is
 * what makes the erasure path tractable — and it is the shape an IAM policy
 * needs if object-level isolation is ever enforced there too.
 *
 * This changed with ADR-005. The keys were `owners/<accountId>/...`, which tied
 * a page to whoever uploaded it: revoking that helper would have left the file
 * sitting under their prefix, and deleting a patient's record would have meant
 * visiting every account that had ever added to it.
 *
 * The key contains no name, no date of birth and no filename from the device.
 * A bucket listing is metadata, and metadata about medical records leaks.
 */
export const pageKey = ({ patientId, documentId, page }: PageLocation): string =>
  `patients/${patientId}/documents/${documentId}/pages/${String(page).padStart(3, '0')}`;

/**
 * Everything belonging to one patient, as one prefix.
 *
 * The same first two segments as `pageKey`, stated once so the erasure sweep
 * and the key layout cannot drift apart — a prefix that stopped matching would
 * delete nothing and report success.
 */
export const recordPrefix = (patientId: string): string => `patients/${patientId}/`;

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

    async presignDownload(location, expiresInSeconds) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket, Key: pageKey(location) }), {
        expiresIn: expiresInSeconds,
      });
    },

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

    prefixFor: recordPrefix,

    /**
     * Lists and deletes, a page at a time, until the prefix is empty.
     *
     * `ListObjectsV2` returns at most 1000 keys with a continuation token, and
     * `DeleteObjects` takes at most 1000 — so the batch size falls out of the
     * API rather than being chosen. The listing is re-issued from the start
     * after each batch rather than followed by token, because deleting as we go
     * changes the listing underneath us and a token into a mutated listing can
     * skip keys.
     */
    async deletePrefix(prefix) {
      let removed = 0;

      for (;;) {
        const listed = await client.send(
          new ListObjectsV2Command({ Bucket, Prefix: prefix, MaxKeys: 1000 }),
        );
        const keys = (listed.Contents ?? []).flatMap((object) =>
          object.Key === undefined ? [] : [{ Key: object.Key }],
        );

        if (keys.length === 0) return { objects: removed };

        await client.send(
          new DeleteObjectsCommand({ Bucket, Delete: { Objects: keys, Quiet: true } }),
        );
        removed += keys.length;
      }
    },
  };
};
