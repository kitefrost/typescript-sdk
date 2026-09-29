import type { AuthProvider } from './auth.js';
import {
  KiteFrostApiError,
  KiteFrostAuthError,
  KiteFrostNotFoundError,
  RateLimited,
  ServerError,
  ValidationError,
} from './errors.js';

export interface HttpClientOptions {
  auth: AuthProvider;
  baseUrl: string;
  /** Injectable fetch (defaults to global fetch) - eases testing. */
  fetchImpl?: typeof fetch;
  /** User-Agent suffix the per-pack SDK appends (e.g. "kitefrost-core/1.0.0"). */
  userAgent?: string;
}

type JsonBody = Record<string, unknown>;

/**
 * Shared HTTP transport. Owns header building, error mapping, and the one-shot
 * 401 refresh (mirrors @kitefrost/sdk http.ts + the Python _transport). A
 * single instance is shared across every per-pack resource client so they pool
 * one auth provider.
 */
export class HttpClient {
  private readonly auth: AuthProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(options: HttpClientOptions) {
    this.auth = options.auth;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.userAgent = options.userAgent ?? 'kitefrost-core';
  }

  private async buildHeaders(authHeader: string): Promise<Record<string, string>> {
    return {
      Authorization: authHeader,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
  }

  /**
   * Send a request, retrying ONCE after a 401 with a refreshed credential
   * (one-shot refresh). Refresh only fires when the auth provider supports it.
   */
  private async send(
    path: string,
    init: Omit<RequestInit, 'headers'>,
    accept?: string,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    const doFetch = async (authHeader: string): Promise<Response> => {
      const headers = await this.buildHeaders(authHeader);
      if (accept) headers.Accept = accept;
      return this.fetchImpl(url, { ...init, headers });
    };

    let response = await doFetch(await this.auth.authHeader());

    if (response.status === 401) {
      const refreshed = await this.auth.refresh();
      if (refreshed) {
        response = await doFetch(refreshed);
      }
    }

    return response;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let code: string | undefined;
      let feedbackId: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: string;
          detail?: string;
          message?: string;
          code?: string;
          feedback_id?: string;
        };
        message = body.error ?? body.detail ?? body.message ?? message;
        code = body.code;
        feedbackId = body.feedback_id;
      } catch {
        // ignore JSON parse failure
      }

      const status = response.status;
      if (status === 401 || status === 403) {
        throw new KiteFrostAuthError(message, feedbackId);
      }
      if (status === 404) {
        throw new KiteFrostNotFoundError(response.url || message, feedbackId);
      }
      if (status === 422) {
        throw new ValidationError(message, feedbackId);
      }
      if (status === 429) {
        const raw = response.headers.get('Retry-After');
        const retryAfter = raw ? Number.parseInt(raw, 10) : undefined;
        throw new RateLimited(Number.isNaN(retryAfter as number) ? undefined : retryAfter, feedbackId);
      }
      if (status >= 500) {
        throw new ServerError(message, status, feedbackId);
      }
      throw new KiteFrostApiError(message, status, code, feedbackId);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return response.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let p = path;
    if (params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) p += `?${qs}`;
    }
    return this.handleResponse<T>(await this.send(p, { method: 'GET' }));
  }

  async post<T>(path: string, body?: JsonBody): Promise<T> {
    return this.handleResponse<T>(
      await this.send(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    );
  }

  async patch<T>(path: string, body: JsonBody): Promise<T> {
    return this.handleResponse<T>(
      await this.send(path, { method: 'PATCH', body: JSON.stringify(body) }),
    );
  }

  async delete<T>(path: string): Promise<T> {
    return this.handleResponse<T>(await this.send(path, { method: 'DELETE' }));
  }
}
