/**
 * Typed errors for the KiteFrost shared core. Mirrors the hand-written
 * @kitefrost/sdk error surface so per-pack SDKs built on the core keep the
 * same DX (KiteFrostApiError / KiteFrostAuthError / KiteFrostNotFoundError /
 * RateLimited, plus the feedbackId field from C-FB1).
 */
/**
 * Escape control characters in server-supplied text. Error text comes from
 * whatever host the client points at; raw ANSI escapes or newlines would let that
 * host rewrite the terminal or forge extra log lines, so they render visibly.
 */
export function printable(text: string): string {
  // Cc (C0/C1 controls), Cf (bidi overrides/isolates, zero-width), Zl/Zp (line and
  // paragraph separators) - the same set Python's str.isprintable() rejects for these.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, (c) => {
    const named: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
    return named[c] ?? `\\u${(c.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
  });
}

export class KiteFrostApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  /**
   * Server-issued ULID (prefix `fbk_`) uniquely identifying this error
   * instance (C-FB1). Pass it back via POST /v1/feedback to annotate or
   * bug-report this specific failure.
   */
  readonly feedbackId?: string;

  constructor(message: string, statusCode: number, code?: string, feedbackId?: string) {
    super(printable(String(message)));
    this.name = 'KiteFrostApiError';
    this.statusCode = statusCode;
    this.code = typeof code === 'string' ? printable(code) : code;
    this.feedbackId = typeof feedbackId === 'string' ? printable(feedbackId) : feedbackId;
  }
}

export class KiteFrostAuthError extends KiteFrostApiError {
  constructor(message = 'Unauthorized: invalid or missing credentials', feedbackId?: string) {
    super(message, 401, 'UNAUTHORIZED', feedbackId);
    this.name = 'KiteFrostAuthError';
  }
}

export class KiteFrostNotFoundError extends KiteFrostApiError {
  constructor(resource: string, feedbackId?: string) {
    super(`Not found: ${resource}`, 404, 'NOT_FOUND', feedbackId);
    this.name = 'KiteFrostNotFoundError';
  }
}

export class ValidationError extends KiteFrostApiError {
  constructor(message = 'Validation failed', feedbackId?: string) {
    super(message, 422, 'VALIDATION_ERROR', feedbackId);
    this.name = 'ValidationError';
  }
}

export class RateLimited extends KiteFrostApiError {
  readonly retryAfter: number | undefined;

  constructor(retryAfter?: number, feedbackId?: string) {
    super('Rate limit exceeded', 429, 'RATE_LIMITED', feedbackId);
    this.name = 'RateLimited';
    this.retryAfter = retryAfter;
  }
}

export class ServerError extends KiteFrostApiError {
  constructor(message = 'Server error', statusCode = 500, feedbackId?: string) {
    super(message, statusCode, 'SERVER_ERROR', feedbackId);
    this.name = 'ServerError';
  }
}
