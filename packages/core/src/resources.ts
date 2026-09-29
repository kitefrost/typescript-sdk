import type { HttpClient } from './http.js';

/**
 * Shared-core resource clients. These cover the SHARED_TAGS surface
 * (src/engine/api/pack_manifest.py: auth, keys, billing, projects, events,
 * context, byok, webhooks, health, ...) that is identical across every pack and
 * is therefore owned by the core, NOT generated per pack (PPI-3). Pack-specific
 * resources are generated on top of these by STREAM-003 TASK-003.
 *
 * NO pack-specific code lives here - only the universal infrastructure surface.
 */

abstract class BaseResource {
  constructor(protected readonly http: HttpClient) {}
}

/** auth tag - whoami / token introspection. */
export class AuthResource extends BaseResource {
  whoami<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/auth/whoami');
  }
}

/** keys tag - API key management. */
export class KeysResource extends BaseResource {
  list<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/keys');
  }
  create<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.http.post<T>('/v1/keys', body);
  }
  revoke<T = unknown>(keyId: string): Promise<T> {
    return this.http.delete<T>(`/v1/keys/${encodeURIComponent(keyId)}`);
  }
}

/** billing tag - usage + balance. */
export class BillingResource extends BaseResource {
  usage<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/billing/usage');
  }
}

/** projects tag - project lifecycle (shared across all packs). */
export class ProjectsResource extends BaseResource {
  list<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/projects');
  }
  get<T = unknown>(projectId: string): Promise<T> {
    return this.http.get<T>(`/v1/projects/${encodeURIComponent(projectId)}`);
  }
  create<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.http.post<T>('/v1/projects', body);
  }
}

/** events tag - client/telemetry event ingestion. */
export class EventsResource extends BaseResource {
  send<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.http.post<T>('/v1/events', body);
  }
}

/** context tag - shared context retrieval. */
export class ContextResource extends BaseResource {
  get<T = unknown>(projectId: string, params?: Record<string, string | number>): Promise<T> {
    return this.http.get<T>(`/v1/projects/${encodeURIComponent(projectId)}/context`, params);
  }
}

/** byok tag - bring-your-own-key provider credentials. */
export class ByokResource extends BaseResource {
  list<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/byok');
  }
  set<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.http.post<T>('/v1/byok', body);
  }
}

/** webhooks tag - webhook subscription management. */
export class WebhooksResource extends BaseResource {
  list<T = unknown>(): Promise<T> {
    return this.http.get<T>('/v1/webhooks');
  }
  create<T = unknown>(body: Record<string, unknown>): Promise<T> {
    return this.http.post<T>('/v1/webhooks', body);
  }
  delete<T = unknown>(webhookId: string): Promise<T> {
    return this.http.delete<T>(`/v1/webhooks/${encodeURIComponent(webhookId)}`);
  }
}

/** health tag - liveness probe (the canonical core smoke endpoint). */
export class HealthResource extends BaseResource {
  check<T = unknown>(): Promise<T> {
    // Liveness probe is served at the root `/health` (the API does NOT
    // expose `/v1/health` - that 404s). Mirrors the Python core fix -
    // see check-sdk-core-parity.py, which now asserts these stay in sync.
    return this.http.get<T>('/health');
  }
}
