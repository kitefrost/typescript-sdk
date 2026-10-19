import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KiteFrostCore } from '../src/core.js';

test('old BYOK calls explain the required project before transport', () => {
  const requests: unknown[] = [];
  const core = new KiteFrostCore({
    apiKey: 'test', baseUrl: 'https://api.kitefrost.ai',
    fetchImpl: (async (...args: unknown[]) => {
      requests.push(args);
      return Response.json({});
    }) as typeof fetch,
  });
  assert.throws(() => {
    // @ts-expect-error Project ID is required by the new signature.
    core.byok.list();
  }, /byok\.list\(projectId\)/);
  assert.throws(() => {
    // @ts-expect-error The old body-only call must name its project first.
    core.byok.set({ api_key: 'test' });
  }, /byok\.set\(projectId, body\)/);
  assert.deepEqual(requests, []);
});

test('BYOK project lifecycle and scan return server outcomes', async () => {
  let stored = false;
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname === '/v1/byok/scan' && init.method === 'POST') {
      return Response.json({ safe: true });
    }
    if (url.pathname !== '/v1/projects/project%2Fone/byok') {
      return Response.json({ detail: 'Unknown endpoint' }, { status: 404 });
    }
    if (init.method === 'PUT') stored = Boolean(JSON.parse(init.body as string).api_key);
    else if (init.method === 'DELETE') {
      stored = false;
      return new Response(null, { status: 204 });
    } else if (init.method !== 'GET') return new Response(null, { status: 405 });
    return Response.json({ has_key: stored });
  }) as typeof fetch;
  const core = new KiteFrostCore({ apiKey: 'test', baseUrl: 'https://api.kitefrost.ai', fetchImpl });
  assert.deepEqual(await core.byok.list('project/one'), { has_key: false });
  assert.deepEqual(await core.byok.set('project/one', { api_key: 'test' }), { has_key: true });
  assert.deepEqual(await core.byok.list('project/one'), { has_key: true });
  assert.equal(await core.byok.delete('project/one'), undefined);
  assert.deepEqual(await core.byok.list('project/one'), { has_key: false });
  assert.deepEqual(await core.byok.scan({ response_text: 'A story.' }), { safe: true });
});

for (const mediaType of ['text/markdown', 'text/plain', 'application/x-ink', 'application/x-yarn']) {
  test(`export returns ${mediaType} text unchanged`, async () => {
    const core = new KiteFrostCore({
      apiKey: 'test', baseUrl: 'https://api.kitefrost.ai',
      fetchImpl: (async () => new Response('# Chapter\nA story.\n', {
        headers: { 'Content-Type': `${mediaType}; charset=utf-8` },
      })) as typeof fetch,
    });
    assert.equal(await core.http.post('/export', { format: 'markdown' }), '# Chapter\nA story.\n');
  });
}

for (const mediaType of ['application/json', 'application/vnd.kitefrost+json']) {
  test(`export keeps ${mediaType} structured`, async () => {
    const core = new KiteFrostCore({
      apiKey: 'test', baseUrl: 'https://api.kitefrost.ai',
      fetchImpl: (async () => new Response('{"nodes":[]}', {
        headers: { 'Content-Type': mediaType },
      })) as typeof fetch,
    });
    assert.deepEqual(await core.http.post('/export'), { nodes: [] });
  });
}
