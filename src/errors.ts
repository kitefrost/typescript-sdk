export class KiteFrostApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  /**
   * Server-issued ULID (prefix `fbk_`) uniquely identifying this error
   * instance (C-FB1). Pass it back via POST /v1/feedback to annotate or
   * bug-report this specific failure.
   */
  readonly feedbackId?: string;

  constructor(
    message: string,
    statusCode: number,
    code?: string,
    feedbackId?: string,
  ) {
    super(message);
    this.name = 'KiteFrostApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.feedbackId = feedbackId;
  }
}

export class KiteFrostAuthError extends KiteFrostApiError {
  constructor(
    message = 'Unauthorized: invalid or missing API key',
    feedbackId?: string,
  ) {
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

// Convenience aliases matching the public API surface
export class AuthError extends KiteFrostAuthError {
  constructor(message?: string, feedbackId?: string) {
    super(message, feedbackId);
    this.name = 'AuthError';
  }
}

export class ProjectNotFound extends KiteFrostNotFoundError {
  constructor(projectId: string, feedbackId?: string) {
    super(projectId, feedbackId);
    this.name = 'ProjectNotFound';
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
