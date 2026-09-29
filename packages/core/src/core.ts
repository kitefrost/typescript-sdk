import { ApiKeyAuth, type AuthProvider } from './auth.js';
import { HttpClient } from './http.js';
import {
  AuthResource,
  BillingResource,
  ByokResource,
  ContextResource,
  EventsResource,
  HealthResource,
  KeysResource,
  ProjectsResource,
  WebhooksResource,
} from './resources.js';
import { CORE_VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://api.kitefrost.ai';

/** Env var that repoints the client (e.g. an early-access API), same as the Python SDK. */
export const BASE_URL_ENV = 'KITEFROST_BASE_URL';

/**
 * Explicit option > KITEFROST_BASE_URL > DEFAULT_BASE_URL (parity with Python,
 * FND-20260926-E5C). The env read is guarded so browsers and edge runtimes
 * without `process` fall through to the default.
 */
export function resolveBaseUrl(baseUrl: string | undefined): string {
  if (baseUrl) return baseUrl;
  const env = typeof process !== 'undefined' ? process.env?.[BASE_URL_ENV] : undefined;
  return env || DEFAULT_BASE_URL;
}

export interface KiteFrostCoreConfig {
  /** Static API key. Provide this OR `auth`, not both. */
  apiKey?: string;
  /** Custom auth provider (e.g. refreshable bearer). Provide this OR `apiKey`. */
  auth?: AuthProvider;
  /** API base URL. Defaults to https://api.kitefrost.ai. */
  baseUrl?: string;
  /** Injectable fetch (testing / non-global-fetch runtimes). */
  fetchImpl?: typeof fetch;
  /** User-Agent (a per-pack SDK overrides this with its own name+version). */
  userAgent?: string;
}

/**
 * Single configuration entry for the shared core.
 *
 * Constructing one KiteFrostCore yields ONE auth provider + one HttpClient that
 * every shared-core resource client reuses. Per-pack SDKs accept an existing
 * KiteFrostCore instance so a customer running multiple packs shares a single
 * auth provider / connection pool - the Option-A DX win (D-PPI-SDK-BUNDLING).
 */
export class KiteFrostCore {
  readonly version = CORE_VERSION;
  readonly http: HttpClient;
  readonly auth: AuthResource;
  readonly keys: KeysResource;
  readonly billing: BillingResource;
  readonly projects: ProjectsResource;
  readonly events: EventsResource;
  readonly context: ContextResource;
  readonly byok: ByokResource;
  readonly webhooks: WebhooksResource;
  readonly health: HealthResource;

  constructor(config: KiteFrostCoreConfig) {
    if (!config.apiKey && !config.auth) {
      throw new Error('KiteFrostCore requires either `apiKey` or `auth`.');
    }
    const authProvider: AuthProvider = config.auth ?? new ApiKeyAuth(config.apiKey as string);

    this.http = new HttpClient({
      auth: authProvider,
      baseUrl: resolveBaseUrl(config.baseUrl),
      fetchImpl: config.fetchImpl,
      userAgent: config.userAgent ?? `kitefrost-core/${CORE_VERSION}`,
    });

    this.auth = new AuthResource(this.http);
    this.keys = new KeysResource(this.http);
    this.billing = new BillingResource(this.http);
    this.projects = new ProjectsResource(this.http);
    this.events = new EventsResource(this.http);
    this.context = new ContextResource(this.http);
    this.byok = new ByokResource(this.http);
    this.webhooks = new WebhooksResource(this.http);
    this.health = new HealthResource(this.http);
  }
}
