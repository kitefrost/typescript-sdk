/**
 * SDK auto-telemetry for error reporting (C-FB3).
 *
 * Fire-and-forget error telemetry sender. Never throws, never retries,
 * never blocks the caller beyond 100ms.
 *
 * Design reference:
 *   docs/design/concepts/feedback-channels/design.md section 1
 */

import { KiteFrostApiError } from './errors.js';

/** SDK version - mirrors package.json. */
export const SDK_VERSION = '0.1.0';

/** In-memory dedup: set of API keys that have already seen the banner. */
const _bannerShown = new Set<string>();

/** Telemetry timeout in milliseconds - per CDS design. */
const TELEMETRY_TIMEOUT_MS = 100;

// ---------------------------------------------------------------------------
// Env-var resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective reportErrors flag.
 *
 * `KITEFROST_REPORT_ERRORS=false` (env var or globalThis) overrides
 * a code-level `true`.
 */
export function resolveReportErrors(codeLevel: boolean): boolean {
  // Node.js: process.env
  let envVal: string | undefined;
  if (typeof process !== 'undefined' && process.env) {
    envVal = process.env['KITEFROST_REPORT_ERRORS'];
  }
  // Browser fallback: globalThis
  if (!envVal && typeof globalThis !== 'undefined') {
    envVal = (globalThis as Record<string, unknown>)['KITEFROST_REPORT_ERRORS'] as
      | string
      | undefined;
  }
  if (envVal?.toLowerCase() === 'false') {
    return false;
  }
  return codeLevel;
}

// ---------------------------------------------------------------------------
// First-run banner
// ---------------------------------------------------------------------------

/**
 * Log the first-run telemetry banner once per API key per process.
 */
export function warnTelemetryEnabledOnce(apiKey: string): void {
  if (_bannerShown.has(apiKey)) return;
  _bannerShown.add(apiKey);
  // eslint-disable-next-line no-console
  console.info(
    '[kitefrost] Error telemetry enabled. ' +
      'We collect crash info (not conversation content) to fix bugs. ' +
      'Opt out: new Project("name", { apiKey, reportErrors: false }) ' +
      'or set KITEFROST_REPORT_ERRORS=false. ' +
      'Docs: https://docs.kitefrost.ai/telemetry',
  );
}

// ---------------------------------------------------------------------------
// Payload builder
// ---------------------------------------------------------------------------

interface TelemetryPayload {
  schema_version: string;
  signal: string;
  ref: string | undefined;
  payload: {
    error: {
      message: string;
      statusCode: number;
      code: string | undefined;
      feedbackId: string | undefined;
    };
    client: {
      sdk: string;
      sdk_version: string;
      runtime: string;
      os: string;
    };
    attempt: number;
    latency_ms: number | undefined;
  };
  context?: { request_body: unknown };
}

function detectRuntime(): string {
  if (typeof process !== 'undefined' && process.versions?.node) {
    return `node/${process.versions.node}`;
  }
  if (typeof navigator !== 'undefined' && navigator.userAgent) {
    return navigator.userAgent.slice(0, 120);
  }
  return 'unknown';
}

function detectOs(): string {
  if (typeof process !== 'undefined' && process.platform) {
    return process.platform;
  }
  return 'browser';
}

export function buildTelemetryPayload(
  err: KiteFrostApiError,
  reportContext: boolean,
): TelemetryPayload {
  const payload: TelemetryPayload = {
    schema_version: '1',
    signal: 'error_telemetry',
    ref: err.feedbackId,
    payload: {
      error: {
        message: err.message,
        statusCode: err.statusCode,
        code: err.code,
        feedbackId: err.feedbackId,
      },
      client: {
        sdk: 'kitefrost-js',
        sdk_version: SDK_VERSION,
        runtime: detectRuntime(),
        os: detectOs(),
      },
      attempt: 1,
      latency_ms: undefined,
    },
  };
  if (reportContext) {
    // Reserved for future use - the TS SDK doesn't currently carry request_body on errors
    payload.context = { request_body: null };
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Fire-and-forget sender
// ---------------------------------------------------------------------------

/**
 * Send error telemetry via fire-and-forget fetch.
 *
 * Uses `AbortSignal.timeout(100)` so the request is abandoned after 100ms.
 * Wrapped in try/catch - never throws, never blocks the caller.
 */
export async function sendTelemetry(
  err: KiteFrostApiError,
  baseUrl: string,
  reportContext: boolean,
  apiKey?: string,
): Promise<void> {
  try {
    const payload = buildTelemetryPayload(err, reportContext);
    const url = `${baseUrl.replace(/\/$/, '')}/v1/feedback`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TELEMETRY_TIMEOUT_MS),
    });
  } catch {
    // fire-and-forget - telemetry must never break caller
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Clear the banner dedup set. For testing only. */
export function resetBannerState(): void {
  _bannerShown.clear();
}
