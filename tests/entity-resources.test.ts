/**
 * Unit tests for the flat per-type entity resource accessors
 * (project.npcs / places / factions / items / players).
 * Uses fetch mocking - no network calls.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Project } from '../src/project';

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'http://mock',
    json: async () => body,
  } as Response;
}

type FetchMock = jest.MockedFunction<typeof fetch>;
let mockFetch: FetchMock;

beforeEach(() => {
  mockFetch = jest.fn<typeof fetch>();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

afterEach(() => {
  jest.resetAllMocks();
});

const PROJECT_STUB = { id: 'prj_test', name: 'test-project', created_at: '2026-01-01T00:00:00Z' };

function entityStub(externalId: string, type: string) {
  return {
    id: `ent_${externalId}`,
    external_id: externalId,
    type,
    name: externalId,
    properties: {},
    project_id: 'prj_test',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

// first call is always project creation
function setupMocks(responses: Response[]): void {
  mockFetch.mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201));
  for (const r of responses) {
    mockFetch.mockResolvedValueOnce(r);
  }
}

function callUrl(callIndex: number): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[0];
}

function callBody(callIndex: number): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

// accessor name -> canonical type -> plural path tail
const CASES: Array<{ accessor: 'npcs' | 'places' | 'factions' | 'items' | 'players'; type: string; plural: string }> = [
  { accessor: 'npcs', type: 'npc', plural: 'npcs' },
  { accessor: 'places', type: 'location', plural: 'locations' },
  { accessor: 'factions', type: 'faction', plural: 'factions' },
  { accessor: 'items', type: 'item', plural: 'items' },
  { accessor: 'players', type: 'player', plural: 'players' },
];

describe.each(CASES)('project.$accessor entity resource', ({ accessor, type, plural }) => {
  it(`create POSTs to /generic/${plural} with the entity payload`, async () => {
    setupMocks([makeResponse(entityStub('thing', type), 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result = await project[accessor].create('thing', { type, name: 'Thing', mood: 'calm' });

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(callUrl(1)).toMatch(new RegExp(`/projects/[^/]+/generic/${plural}$`));

    const body = callBody(1);
    expect(body['external_id']).toBe('thing');
    expect(body['name']).toBe('Thing');
    // canonical type is encoded in the URL path, not the body
    expect(body['type']).toBeUndefined();
    expect((body['properties'] as Record<string, unknown>)['mood']).toBe('calm');

    expect(result.externalId).toBe('thing');
    expect(result.type).toBe(type);
  });

  it(`list GETs /generic/${plural}`, async () => {
    setupMocks([
      makeResponse({ entities: [entityStub('a', type), entityStub('b', type)], total: 2 }, 200),
    ]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result = await project[accessor].list();

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method ?? 'GET').toBe('GET');
    expect(callUrl(1)).toMatch(new RegExp(`/projects/[^/]+/generic/${plural}$`));

    expect(result.total).toBe(2);
    expect(result.entities).toHaveLength(2);
    expect(result.entities[0].externalId).toBe('a');
  });

  it(`get GETs /generic/${plural}/{id}`, async () => {
    setupMocks([makeResponse(entityStub('gideon', type), 200)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result = await project[accessor].get('gideon');

    const [, init] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(init.method ?? 'GET').toBe('GET');
    expect(callUrl(1)).toMatch(new RegExp(`/projects/[^/]+/generic/${plural}/gideon$`));

    expect(result.externalId).toBe('gideon');
    expect(result.type).toBe(type);
  });
});
