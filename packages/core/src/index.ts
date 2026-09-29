/**
 * @kitefrost/core - shared runtime for every per-pack KiteFrost SDK.
 *
 * Owns HTTP transport, auth (incl. one-shot 401 refresh), error types, and the
 * SHARED_TAGS resource clients. Per-pack SDKs depend on this package and add
 * only their pack-specific resources on top (PPI-3, D-PPI-SDK-BUNDLING Option A).
 */
export { KiteFrostCore, DEFAULT_BASE_URL, BASE_URL_ENV, resolveBaseUrl } from './core.js';
export type { KiteFrostCoreConfig } from './core.js';
export { HttpClient } from './http.js';
export type { HttpClientOptions } from './http.js';
export { ApiKeyAuth, RefreshableTokenAuth } from './auth.js';
export type { AuthProvider } from './auth.js';
export {
  KiteFrostApiError,
  KiteFrostAuthError,
  KiteFrostNotFoundError,
  ValidationError,
  RateLimited,
  ServerError,
} from './errors.js';
export {
  AuthResource,
  KeysResource,
  BillingResource,
  ProjectsResource,
  EventsResource,
  ContextResource,
  ByokResource,
  WebhooksResource,
  HealthResource,
} from './resources.js';
export { CORE_VERSION, assertCoreVersionCompatible } from './version.js';
