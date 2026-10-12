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

const warnedHosts = new Set<string>();

/**
 * True only for `localhost` or a literal loopback IP. Never a string prefix:
 * `127.evil.example` is a DNS name that can resolve anywhere. WHATWG URL already
 * canonicalises IPv4 spellings (`127.1`, `0x7f.1` -> `127.0.0.1`), so a dotted quad
 * here is a real address.
 */
function isLoopback(host: string): boolean {
  if (host === 'localhost') return true;
  const v4 = /^(\d{1,3})\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) return v4[1] === '127';
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    // WHATWG serialises IPv6 compressed (`[::1]`) and mapped IPv4 as hex (`[::ffff:7f00:1]`).
    return v6 === '::1' || /^::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}$/.test(v6);
  }
  return false;
}

/**
 * Whatever host the base URL names receives the bearer credential on every call,
 * so it is checked before use (parity with Python `check_base_url`; see
 * tests/base-url-tampering.test.ts):
 *  - scheme must be https; plain http only to a loopback dev server
 *  - no `user:pass@` part (the lookalike trick: `https://api.kitefrost.ai@evil.example`
 *    goes to evil.example)
 *  - a host outside kitefrost.ai / loopback warns once, naming the REAL host.
 *    Warn, not block: proxies and local servers are legitimate.
 */
export function checkBaseUrl(url: string, source = 'baseUrl'): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${source}: not a valid URL: ${JSON.stringify(url)}`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) throw new Error(`${source}: URL has no host: ${JSON.stringify(url)}`);
  if (parsed.username || parsed.password) {
    throw new Error(`${source}: credentials in the URL are not allowed (the request would go to "${host}")`);
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopback(host))) {
    throw new Error(
      `${source}: scheme "${parsed.protocol.replace(/:$/, '')}" not allowed - use https ` +
        '(plain http is accepted only for localhost dev servers)',
    );
  }
  if (host === 'kitefrost.ai' || host.endsWith('.kitefrost.ai') || isLoopback(host)) return;
  if (warnedHosts.has(host)) return;
  warnedHosts.add(host);
  console.warn(
    `[kitefrost] API requests and your API key will be sent to "${host}" (from ${source}), ` +
      'which is not a kitefrost.ai host. Unset it unless you trust that server.',
  );
}

/** Test hook: forget which foreign hosts have already been announced. */
export function _resetBaseUrlWarnings(): void {
  warnedHosts.clear();
}


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
    // Checked here, not only in KiteFrostCore: HttpClient is exported, and every
    // request it sends carries the bearer credential to this host.
    checkBaseUrl(options.baseUrl);
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
