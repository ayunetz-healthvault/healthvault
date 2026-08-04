import { createHash } from 'node:crypto';

/**
 * Derives the reference sent to an external provider.
 *
 * The vault's real document id is stored against a real user. A provider's
 * request logs are outside our control and may be retained; sending the real id
 * would create a durable join key between their logs and our database. A hash
 * gives support a way to correlate a failure without handing over that key.
 *
 * SHA-256 truncated to 16 hex characters. Not a secret and not reversible into
 * anything useful, because the input is already an opaque identifier rather
 * than a small guessable space like a phone number.
 */
export const pseudonymousDocumentId = (documentId: string): string =>
  `doc_${createHash('sha256').update(documentId).digest('hex').slice(0, 16)}`;
