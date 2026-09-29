import { KiteFrostApiError, KiteFrostAuthError, KiteFrostNotFoundError } from './errors.js';

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
}

/**
 * JSON request-body shape accepted by the post/patch helpers below.
 * Exported because callers outside this module (e.g. `Project.graphql`) annotate
 * their own body objects with it; when it was module-private that annotation was
 * an unresolved name and every SDK test suite failed to compile.
 */
export type JsonBody = Record<string, unknown>;

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: HttpClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  private buildHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      throw new KiteFrostAuthError();
    }

    if (response.status === 404) {
      throw new KiteFrostNotFoundError(response.url);
    }

    if (!response.ok) {
      let message = `HTTP ${response.status}`;
      let code: string | undefined;
      let feedbackId: string | undefined;
      try {
        const body = (await response.json()) as {
          error?: string;
          code?: string;
          feedback_id?: string;
        };
        message = body.error ?? message;
        code = body.code;
        feedbackId = body.feedback_id;
      } catch {
        // ignore JSON parse failure
      }
      throw new KiteFrostApiError(message, response.status, code, feedbackId);
    }

    // 204 No Content (and other empty-body 2xx) have nothing to parse.
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    let url = `${this.baseUrl}${path}`;
    if (params) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&');
      if (qs) url += `?${qs}`;
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    return this.handleResponse<T>(response);
  }

  async post<T>(path: string, body: JsonBody): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  async patch<T>(path: string, body: JsonBody): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PATCH',
      headers: this.buildHeaders(),
      body: JSON.stringify(body),
    });

    return this.handleResponse<T>(response);
  }

  async delete<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'DELETE',
      headers: this.buildHeaders(),
    });

    return this.handleResponse<T>(response);
  }

  /**
   * Perform a POST request and return the response body as an ArrayBuffer.
   * Used for binary payloads such as the full-project export ZIP, which is
   * not JSON. Error responses are still routed through the JSON error
   * handler so callers get a typed KiteFrostApiError.
   */
  async postBinary(path: string, body: JsonBody): Promise<ArrayBuffer> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...this.buildHeaders(),
        Accept: 'application/octet-stream',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      // Re-use JSON error handling for non-binary error bodies.
      await this.handleResponse(response);
    }

    return response.arrayBuffer();
  }

  /**
   * Perform a GET request and return the raw Response (for SSE streaming).
   */
  async getRaw(path: string): Promise<Response> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        ...this.buildHeaders(),
        Accept: 'text/event-stream',
      },
    });

    if (!response.ok) {
      // Re-use JSON error handling for non-stream errors
      await this.handleResponse(response);
    }

    return response;
  }
}
