/**
 * Client-side identifiers.
 *
 * Records are created optimistically on-device (the app must work on a patchy
 * connection from an Indian mobile network), so IDs are minted here and reused
 * verbatim as the DynamoDB sort key. The prefix makes items self-describing in
 * the table and in logs.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

const randomChunk = (length: number): string => {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
};

export type IdPrefix =
  | 'par'
  | 'doc'
  | 'pag'
  | 'sum'
  | 'fup'
  | 'job'
  | 'usr'
  | 'fnd'
  | 'med'
  /**
   * An outbox mutation, and the idempotency key that travels with it.
   *
   * Generated once, before the first attempt, and reused on every retry — see
   * `Mutation.id`. A request that times out after the server committed it is
   * indistinguishable from one that never arrived, so the retry has to be
   * recognisable as the same change.
   */
  | 'mut'
  /** A recorded dose occurrence. */
  | 'dse'
  /** A confirmed treatment schedule. Never minted from a document alone. */
  | 'trt'
  /** A symptom or observation written by a person. */
  | 'obs';

/**
 * Monotonic-ish, sortable, collision-resistant enough for a single device.
 *
 * TODO(backend): the Lambda write path should reject any client ID that does
 * not match /^[a-z]{3}_[0-9a-z]{8}_[0-9a-z]{6}$/ before persisting it.
 */
export const createId = (prefix: IdPrefix): string =>
  `${prefix}_${Date.now().toString(36).padStart(8, '0')}_${randomChunk(6)}`;
