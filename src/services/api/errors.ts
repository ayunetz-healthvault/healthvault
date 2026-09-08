/** Error taxonomy shared by every service so screens can branch on `kind`. */
export type ApiErrorKind =
  | 'network' // device is offline or the request never reached API Gateway
  | 'timeout'
  | 'unauthorized' // Cognito token missing/expired — send the user to re-auth
  | 'forbidden' // authenticated, but not this caregiver's record
  | 'not_found'
  | 'conflict'
  | 'too_large'
  | 'rate_limited'
  | 'server'
  | 'unknown';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /** API Gateway request id, echoed back for support tickets. */
  readonly requestId: string | null;
  /**
   * Structured detail the server sent with a refusal.
   *
   * Some refusals are only actionable with it: "these records would be left
   * with nobody" is a different message from a list of which ones, and a screen
   * that has to say "something went wrong" instead is telling the user less
   * than the server told the app. Never rendered raw — a caller reads the field
   * it expects and ignores the rest.
   */
  readonly details: Record<string, unknown> | null;

  constructor(
    kind: ApiErrorKind,
    message: string,
    options: {
      status?: number | null;
      requestId?: string | null;
      details?: Record<string, unknown> | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = options.status ?? null;
    this.requestId = options.requestId ?? null;
    this.details = options.details ?? null;
  }

  /** Copy that is safe to show a non-technical caregiver. */
  get userMessage(): string {
    switch (this.kind) {
      case 'network':
        return 'You appear to be offline. Your changes are saved on this phone and will sync later.';
      case 'timeout':
        return 'That took too long. Please check your connection and try again.';
      case 'unauthorized':
        return 'Your session has expired. Please sign in again.';
      case 'forbidden':
        return 'You do not have access to this record.';
      case 'not_found':
        return 'We could not find that record. It may have been deleted.';
      case 'too_large':
        return 'That file is too large to upload. Try a smaller scan or split it into pages.';
      case 'rate_limited':
        return 'Too many requests just now. Please wait a moment and try again.';
      case 'conflict':
      case 'server':
      case 'unknown':
      default:
        return 'Something went wrong on our side. Please try again in a moment.';
    }
  }
}

export const kindForStatus = (status: number): ApiErrorKind => {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  /**
   * Gone: the record is being erased, so it is not coming back.
   *
   * Read as `not_found` rather than left to the `unknown` fallback, which
   * retries. A change addressed to a record that is being deleted would
   * otherwise be attempted six times over an hour before anybody was told.
   */
  if (status === 410) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'too_large';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
};

export const toApiError = (error: unknown): ApiError => {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    if (error.name === 'AbortError') {
      return new ApiError('timeout', 'The request timed out.', { cause: error });
    }
    return new ApiError('network', error.message, { cause: error });
  }
  return new ApiError('unknown', 'Unexpected error.', { cause: error });
};
