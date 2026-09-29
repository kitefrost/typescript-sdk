import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { ApiKeyAuth, RefreshableTokenAuth } from '../src/auth.js';
import { KiteFrostCore } from '../src/core.js';
import { KiteFrostAuthError, RateLimited, ValidationError } from '../src/errors.js';
import { CORE_VERSION, assertCoreVersionCompatible } from '../src/version.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('version stamp exposed and compatibility check passes for same major', () => {
  // The stamp must equal the version this package publishes as (package.json),
  // not a literal - a literal broke on every version bump.
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(CORE_VERSION, pkg.version);
  assert.doesNotThrow(() => assertCoreVersionCompatible(1));
  assert.throws(() => assertCoreVersionCompatible(2), /version skew/);
});

test('core construction requires apiKey or auth', () => {
  assert.throws(() => new KiteFrostCore({} as never), /requires either/);
});

test('smoke: a core-only client can auth and call the health endpoint', async () => {
  const seen: { url: string; auth: string | null } = { url: '', auth: null };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.url = String(url);
    seen.auth = new Headers(init?.headers).get('Authorization');
    return jsonResponse(200, { status: 'ok' });
  }) as unknown as typeof fetch;

  const core = new KiteFrostCore({ apiKey: 'sk_test', baseUrl: 'https://api.example', fetchImpl });
  const res = await core.health.check<{ status: string }>();

  assert.deepEqual(res, { status: 'ok' });
  // FND-20260829-193: the API only ever served /health at the root, never
  // /v1/health. resources.ts was fixed to call '/health'; this assertion
  // was left asserting the old (404-ing) path.
  assert.equal(seen.url, 'https://api.example/health');
  assert.equal(seen.auth, 'Bearer sk_test');
});

test('one-shot 401 refresh retries with the refreshed token', async () => {
  let calls = 0;
  let refreshes = 0;
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    calls += 1;
    const auth = new Headers(init?.headers).get('Authorization');
    if (auth === 'Bearer stale') return jsonResponse(401, { error: 'expired' });
    return jsonResponse(200, { ok: true });
  }) as unknown as typeof fetch;

  const auth = new RefreshableTokenAuth('stale', async () => {
    refreshes += 1;
    return 'fresh';
  });
  const core = new KiteFrostCore({ auth, baseUrl: 'https://api.example', fetchImpl });
  const res = await core.billing.usage<{ ok: boolean }>();

  assert.deepEqual(res, { ok: true });
  assert.equal(calls, 2);
  assert.equal(refreshes, 1);
});

test('static api-key auth surfaces 401 (no refresh) as KiteFrostAuthError', async () => {
  const fetchImpl = (async () => jsonResponse(401, { error: 'bad key' })) as unknown as typeof fetch;
  const core = new KiteFrostCore({ auth: new ApiKeyAuth('nope'), fetchImpl });
  await assert.rejects(() => core.auth.whoami(), KiteFrostAuthError);
});

test('error mapping: 422 -> ValidationError, 429 -> RateLimited with retryAfter', async () => {
  const fetch422 = (async () => jsonResponse(422, { detail: 'bad' })) as unknown as typeof fetch;
  const core422 = new KiteFrostCore({ apiKey: 'k', fetchImpl: fetch422 });
  await assert.rejects(() => core422.projects.list(), ValidationError);

  const fetch429 = (async () =>
    jsonResponse(429, { error: 'slow down' }, { 'Retry-After': '7' })) as unknown as typeof fetch;
  const core429 = new KiteFrostCore({ apiKey: 'k', fetchImpl: fetch429 });
  await assert.rejects(
    () => core429.events.send({ kind: 'x' }),
    (err: unknown) => err instanceof RateLimited && err.retryAfter === 7,
  );
});

// FND-20260926-E5C: parity with Python - explicit baseUrl > KITEFROST_BASE_URL > default.
test('base URL precedence: option > KITEFROST_BASE_URL > default', async () => {
  const { resolveBaseUrl, DEFAULT_BASE_URL } = await import('../src/core.js');
  const saved = process.env.KITEFROST_BASE_URL;
  try {
    delete process.env.KITEFROST_BASE_URL;
    assert.equal(resolveBaseUrl(undefined), DEFAULT_BASE_URL);
    process.env.KITEFROST_BASE_URL = 'https://env.example';
    assert.equal(resolveBaseUrl(undefined), 'https://env.example');
    assert.equal(resolveBaseUrl('https://explicit.example'), 'https://explicit.example');
  } finally {
    if (saved === undefined) delete process.env.KITEFROST_BASE_URL;
    else process.env.KITEFROST_BASE_URL = saved;
  }
});
