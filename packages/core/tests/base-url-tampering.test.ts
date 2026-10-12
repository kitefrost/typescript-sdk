/**
 * KITEFROST_BASE_URL tampering - what a rogue API host can get out of the SDK.
 *
 * Mirror of sdk/python/packages/core/tests/test_base_url_tampering.py. The env var
 * is read on the SDK user's machine only; our API never calls it. The threat is the
 * reverse: whoever controls the variable receives the user's credentials and
 * payloads and controls every response the SDK parses.
 *
 * A real local HTTP server plays the rogue host. Two kinds of test:
 *  - PIN: a defence or exposure that holds today.
 *  - FIXED: a gap found 2026-10-12 (unsafe schemes, silent foreign hosts, log
 *    forging through error text), asserting the safe behaviour that closed it.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';

import { ApiKeyAuth, RefreshableTokenAuth } from '../src/auth.js';
import { _resetBaseUrlWarnings, KiteFrostCore } from '../src/core.js';
import { KiteFrostApiError, KiteFrostAuthError, printable } from '../src/errors.js';
import { HttpClient } from '../src/http.js';

const API_KEY = 'sk_live_victim_key_0123456789';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

class Rogue {
  seen: Seen[] = [];
  status = 200;
  body = '{}';
  headers: Record<string, string> = { 'Content-Type': 'application/json' };
  url = '';
  private server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      this.seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      res.writeHead(this.status, this.headers);
      res.end(this.body);
    });
  });

  async start(): Promise<void> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  reset(): void {
    this.seen = [];
    this.status = 200;
    this.body = '{}';
    this.headers = { 'Content-Type': 'application/json' };
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((r) => this.server.close(() => r()));
  }
}

const rogue = new Rogue();
const thirdHost = new Rogue();
const savedEnv = process.env.KITEFROST_BASE_URL;

before(async () => {
  await rogue.start();
  await thirdHost.start();
});
after(async () => {
  await rogue.stop();
  await thirdHost.stop();
  if (savedEnv === undefined) delete process.env.KITEFROST_BASE_URL;
  else process.env.KITEFROST_BASE_URL = savedEnv;
});
beforeEach(() => {
  rogue.reset();
  thirdHost.reset();
  _resetBaseUrlWarnings();
  process.env.KITEFROST_BASE_URL = rogue.url;
});

// ---------------------------------------------------------------------- pins

test('PIN: the env var routes the API key to whatever host it names', async () => {
  await new KiteFrostCore({ apiKey: API_KEY }).auth.whoami();
  assert.equal(rogue.seen[0].headers.authorization, `Bearer ${API_KEY}`);
});

test('PIN: byok.set forwards third-party provider keys to the rogue host', async () => {
  await new KiteFrostCore({ apiKey: API_KEY }).byok.set({ provider: 'anthropic', api_key: 'provider-secret-xyz' });
  assert.match(rogue.seen[0].body, /provider-secret-xyz/);
});

test('PIN: rogue host sees only the documented headers', async () => {
  await new KiteFrostCore({ apiKey: API_KEY }).health.check();
  const allowed = new Set([
    'host', 'authorization', 'content-type', 'accept', 'user-agent',
    'accept-encoding', 'accept-language', 'sec-fetch-mode', 'connection', 'content-length',
  ]);
  const leaked = Object.keys(rogue.seen[0].headers).filter((h) => !allowed.has(h));
  assert.deepEqual(leaked, [], `unexpected headers leak: ${leaked}`);
  assert.match(String(rogue.seen[0].headers['user-agent']), /^kitefrost-core\/[^ ]+$/);
});

test('PIN: a cross-host redirect does NOT carry Authorization to the third host', async () => {
  // fetch follows redirects by default (unlike Python httpx). The Fetch spec
  // strips Authorization on a cross-origin redirect; this pins that the runtime
  // we ship on honours it. If it ever regresses, the key hops hosts.
  rogue.status = 307;
  rogue.headers = { Location: `${thirdHost.url}/v1/auth/whoami` };
  await new KiteFrostCore({ apiKey: API_KEY }).auth.whoami();
  assert.equal(thirdHost.seen.length, 1, 'redirect was followed');
  assert.equal(thirdHost.seen[0].headers.authorization, undefined);
});

test('PIN: a rogue 401 makes refreshable auth mint and send a SECOND token', async () => {
  rogue.status = 401;
  const core = new KiteFrostCore({ auth: new RefreshableTokenAuth('tok-1', async () => 'tok-2-fresh') });
  await assert.rejects(core.auth.whoami(), KiteFrostAuthError);
  assert.deepEqual(
    rogue.seen.map((s) => s.headers.authorization),
    ['Bearer tok-1', 'Bearer tok-2-fresh'],
  );
});

test('PIN: userinfo lookalike really routes to the attacker host', () => {
  assert.equal(new URL('https://api.kitefrost.ai@evil.example').hostname, 'evil.example');
});

// --------------------------------------------------------------------- fixed

function captureWarnings(fn: () => void): string[] {
  const seen: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => seen.push(a.map(String).join(' '));
  try {
    fn();
  } finally {
    console.warn = orig;
  }
  return seen;
}

test('FIXED: unsafe schemes, embedded credentials and junk are refused at construction', () => {
  for (const url of [
    'http://api.kitefrost.ai',
    'http://evil.example',
    'file:///etc/passwd',
    'ftp://evil.example',
    'javascript:alert(1)',
    'https://user:pw@api.kitefrost.ai',
    'https://api.kitefrost.ai@evil.example',
    'not a url',
  ]) {
    process.env.KITEFROST_BASE_URL = url;
    assert.throws(() => new KiteFrostCore({ apiKey: API_KEY }), /not allowed|not a valid URL|has no host/, url);
  }
  assert.throws(() => new KiteFrostCore({ apiKey: API_KEY, baseUrl: 'http://evil.example' }), /not allowed/);
});

test('FIXED: plain http stays allowed for loopback dev servers, silently', () => {
  const warnings = captureWarnings(() => {
    for (const url of ['http://localhost:8000', 'http://127.0.0.1:9', 'http://[::1]:8000']) {
      process.env.KITEFROST_BASE_URL = url;
      new KiteFrostCore({ apiKey: API_KEY });
    }
  });
  assert.deepEqual(warnings, []);
});

test('FIXED: a non-kitefrost.ai host warns once, naming the REAL host', () => {
  const cases: [string, string][] = [
    ['https://api.kitefrost.ai.evil.example', 'api.kitefrost.ai.evil.example'],
    ['https://evil.example/api.kitefrost.ai', 'evil.example'],
    ['https://api-kitefrost.ai', 'api-kitefrost.ai'],
    ['https://evilkitefrost.ai', 'evilkitefrost.ai'],
  ];
  for (const [url, host] of cases) {
    process.env.KITEFROST_BASE_URL = url;
    const w = captureWarnings(() => {
      new KiteFrostCore({ apiKey: API_KEY });
      new KiteFrostCore({ apiKey: API_KEY });
    });
    assert.equal(w.length, 1, url);
    assert.ok(w[0].includes(`"${host}"`), w[0]);
  }
});

test('FIXED: genuine kitefrost.ai hosts and the default stay silent', () => {
  const warnings = captureWarnings(() => {
    for (const url of ['https://api.kitefrost.ai', 'https://api-staging.kitefrost.ai', 'https://API.KiteFrost.ai.']) {
      process.env.KITEFROST_BASE_URL = url;
      new KiteFrostCore({ apiKey: API_KEY });
    }
    delete process.env.KITEFROST_BASE_URL;
    new KiteFrostCore({ apiKey: API_KEY });
  });
  assert.deepEqual(warnings, []);
});

test('FIXED: server error text cannot inject control characters (log forging)', async () => {
  rogue.status = 400;
  rogue.body = JSON.stringify({
    detail: 'bad\x1b[2J\nINFO 2026-10-12 payment ok user=admin',
    code: 'X\r\nY',
    feedback_id: 'fbk_\u2028Z',
  });
  const err = await new KiteFrostCore({ apiKey: API_KEY }).auth.whoami().catch((e) => e);
  assert.ok(err instanceof KiteFrostApiError);
  for (const field of [err.message, err.code, err.feedbackId]) {
    assert.doesNotMatch(String(field), /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
  }
  assert.match(err.message, /payment ok/); // escaped and visible, not dropped
});

test('FIXED: ordinary error text is unchanged', async () => {
  rogue.status = 400;
  rogue.body = JSON.stringify({ detail: "Project 'Ünïcode \u2013 ok' not found" });
  const err = await new KiteFrostCore({ apiKey: API_KEY }).auth.whoami().catch((e) => e);
  assert.equal(err.message, "Project 'Ünïcode \u2013 ok' not found");
});

// ------------------------------------- second-model review findings (2026-10-12)

test('FIXED: loopback-lookalike DNS names do not get the http exemption', () => {
  for (const url of ['http://127.evil.example', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example']) {
    process.env.KITEFROST_BASE_URL = url;
    assert.throws(() => new KiteFrostCore({ apiKey: API_KEY }), /not allowed/, url);
  }
  process.env.KITEFROST_BASE_URL = 'https://127.evil.example';
  const w = captureWarnings(() => new KiteFrostCore({ apiKey: API_KEY }));
  assert.equal(w.length, 1);
});

test('FIXED: loopback IP spellings stay allowed', () => {
  const w = captureWarnings(() => {
    for (const url of ['http://127.1:8000', 'http://0x7f.1:8000', 'http://[0:0:0:0:0:0:0:1]:8000', 'http://[::ffff:127.0.0.1]:8000']) {
      process.env.KITEFROST_BASE_URL = url;
      new KiteFrostCore({ apiKey: API_KEY });
    }
  });
  assert.deepEqual(w, []);
});

test('FIXED: the exported HttpClient enforces the same policy', () => {
  assert.throws(
    () => new HttpClient({ auth: new ApiKeyAuth(API_KEY), baseUrl: 'http://evil.example' }),
    /not allowed/,
  );
});

test('FIXED: bidi, zero-width and C1 characters are escaped', () => {
  for (const ch of ['\u202e', '\u200b', '\u2066', '\u0085', '\u009b', '\u2028']) {
    assert.ok(!new KiteFrostApiError(`status: ${ch}DEIFIREV`, 400).message.includes(ch), ch.codePointAt(0)?.toString(16));
  }
  assert.equal(printable('Ünïcode \u2013 ok 🎲'), 'Ünïcode \u2013 ok 🎲');
});
