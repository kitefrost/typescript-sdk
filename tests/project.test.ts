/**
 * Unit tests for @kitefrost/sdk Project class.
 * Uses fetch mocking - no network calls.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Project } from '../src/project';
import { KiteFrostAuthError, KiteFrostApiError } from '../src/errors';
import type { GenerateResponse, EntityResult, ContextResult, EventResult } from '../src/types';

// ---------------------------------------------------------------------------
// Fetch mock helpers
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'http://mock',
    json: async () => body,
  } as Response;
}

// Typed mock for fetch
type FetchMock = jest.MockedFunction<typeof fetch>;

let mockFetch: FetchMock;

beforeEach(() => {
  mockFetch = jest.fn<typeof fetch>();
  (globalThis as { fetch: unknown }).fetch = mockFetch;
});

afterEach(() => {
  jest.resetAllMocks();
});

// Stub project creation response
const PROJECT_STUB = { id: 'prj_test', name: 'test-project', created_at: '2026-01-01T00:00:00Z' };

// Stub entity response
const ENTITY_STUB = {
  id: 'ent_001',
  external_id: 'blacksmith',
  type: 'npc',
  name: 'Gideon',
  properties: { personality: 'gruff but kind' },
  project_id: 'prj_test',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

// Stub event response
const EVENT_STUB = {
  id: 'evt_001',
  type: 'player.bought_sword',
  project_id: 'prj_test',
  created_at: '2026-01-01T00:00:00Z',
};

// Stub context response
const CONTEXT_STUB = {
  entity: { name: 'Gideon' },
  relevant_events: [{ type: 'player.bought_sword', data: {}, session: 1 }],
  facts: [{ subject: 'alice', predicate: 'is_known_as', object: 'Dragon Slayer', since_session: 5 }],
  summary: 'Gideon sold alice a sword.',
};

// Stub generate response
const GENERATE_STUB = {
  content: 'Ah, the Dragon Slayer returns!',
  context_used: { events_referenced: 3, facts_referenced: 1 },
  tokens_used: { input: 2340, output: 89 },
};

// Helper: configure fetch to auto-create project then return per-call responses
function setupMocks(responses: Response[]): void {
  // first call is always project creation
  mockFetch.mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201));
  for (const r of responses) {
    mockFetch.mockResolvedValueOnce(r);
  }
}

// Helper: get parsed body from a mock call
function getCallBody(callIndex: number): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

// Helper: get URL from a mock call
function getCallUrl(callIndex: number): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[0];
}

// Helper: get headers from a mock call
function getCallHeaders(callIndex: number): Record<string, string> {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[1].headers as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Project - constructor', () => {
  it('creates instance without network calls', () => {
    expect(() => new Project('medieval-rpg', { apiKey: 'sk_test' })).not.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('Project.graphql()', () => {
  // graphql() is THIN TRANSPORT: unlike entity()/event()/context() it does NOT
  // call ensureProject(), so there is no auto-create POST ahead of it and the
  // graphql request is call 0. Matches sdk/python (_client.py::graphql posts
  // straight to /v1/graphql) and the graphql-customer-dx design ("Transport
  // only, ~20 lines"). Do NOT use setupMocks() here - it queues a project-create
  // response first, which graphql() would consume as its own envelope.
  it('posts query + variables to /v1/graphql and returns the envelope', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ data: { project: { id: 'p1' } } }, 200));

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const out = await project.graphql<{ data: { project: { id: string } } }>(
      'query($id:String!){project(id:$id){id}}',
      { id: 'p1' },
    );

    expect(out.data.project.id).toBe('p1');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(getCallUrl(0)).toContain('/v1/graphql');
    const body = getCallBody(0);
    expect(body.query).toContain('project');
    expect(body.variables).toEqual({ id: 'p1' });
  });

  it('omits variables when not provided', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ data: {} }, 200));
    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.graphql('{ __typename }');
    const body = getCallBody(0);
    expect(body.variables).toBeUndefined();
  });
});

describe('Project.entity()', () => {
  it('auto-creates project then upserts entity', async () => {
    setupMocks([makeResponse(ENTITY_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result: EntityResult = await project.entity('blacksmith', {
      type: 'npc',
      name: 'Gideon',
      personality: 'gruff but kind',
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('ent_001');
    expect(result.externalId).toBe('blacksmith');
    expect(result.type).toBe('npc');
    expect(result.name).toBe('Gideon');
  });

  it('caches project ID - second entity call skips project creation', async () => {
    // project creation once, then two entity calls
    mockFetch
      .mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201))
      .mockResolvedValueOnce(makeResponse(ENTITY_STUB, 201))
      .mockResolvedValueOnce(makeResponse({ ...ENTITY_STUB, id: 'ent_002', external_id: 'innkeeper' }, 201));

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.entity('blacksmith', { type: 'npc', name: 'Gideon' });
    await project.entity('innkeeper', { type: 'npc', name: 'Martha' });

    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 project + 2 entities
  });

  it('sends correct payload to API', async () => {
    setupMocks([makeResponse(ENTITY_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.entity('blacksmith', { type: 'npc', name: 'Gideon', personality: 'gruff' });

    const body = getCallBody(1);
    expect(body['external_id']).toBe('blacksmith');
    // `type` is no longer in the body - the canonical type is encoded
    // in the URL path (/generic/npcs).
    expect(body['type']).toBeUndefined();
    expect(body['name']).toBe('Gideon');
    expect((body['properties'] as Record<string, unknown>)['personality']).toBe('gruff');
  });

  it('targets the pack-prefix path /generic/<type>s', async () => {
    setupMocks([makeResponse(ENTITY_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.entity('blacksmith', { type: 'npc', name: 'Gideon' });

    // Call 0 is the project-creation POST; call 1 is the entity upsert.
    const [url] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/projects\/[^/]+\/generic\/npcs$/);
  });

  it('rejects unknown entity types client-side', async () => {
    setupMocks([]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    // EntityProperties.type is `string`, so `'monster'` is statically
    // valid even though the runtime guard rejects it.
    await expect(
      project.entity('x', { type: 'monster', name: 'X' }),
    ).rejects.toThrow(/Unknown entity type/);
  });
});

describe('Project.event()', () => {
  it('records an event and returns EventResult', async () => {
    setupMocks([makeResponse(EVENT_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result: EventResult = await project.event('player.bought_sword', {
      entity: 'blacksmith',
      player: 'alice',
      details: 'haggled to 35 gold',
    });

    expect(result.id).toBe('evt_001');
    expect(result.type).toBe('player.bought_sword');
  });

  it('resolves EntityResult to externalId when entity object passed', async () => {
    setupMocks([makeResponse(EVENT_STUB, 201)]);

    const entityResult: EntityResult = {
      id: 'ent_001',
      externalId: 'blacksmith',
      type: 'npc',
      name: 'Gideon',
      properties: {},
      projectId: 'prj_test',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.event('player.bought_sword', { entity: entityResult, player: 'alice' });

    const body = getCallBody(1);
    expect(body['entity_id']).toBe('blacksmith');
  });

  it('maps player to player_id in request body', async () => {
    setupMocks([makeResponse(EVENT_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.event('player.entered', { player: 'alice' });

    const body = getCallBody(1);
    expect(body['player_id']).toBe('alice');
  });
});

describe('Project.context()', () => {
  it('returns ContextResult with camelCase fields', async () => {
    setupMocks([makeResponse(CONTEXT_STUB)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const result: ContextResult = await project.context({ query: 'blacksmith knows alice', entityId: 'ent_001' });

    expect(result.relevantEvents).toHaveLength(1);
    expect(result.facts[0].sinceSession).toBe(5);
    expect(result.summary).toBe('Gideon sold alice a sword.');
  });

  it('builds query string parameters correctly', async () => {
    setupMocks([makeResponse(CONTEXT_STUB)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.context({ query: 'hello project', entityId: 'ent_abc', sinceSession: 3 });

    const url = getCallUrl(1);
    expect(url).toContain('query=hello%20project');
    expect(url).toContain('entity_id=ent_abc');
    expect(url).toContain('since_session=3');
  });
});

describe('Project.generate()', () => {
  it('returns GenerateResponse with text alias', async () => {
    setupMocks([makeResponse(GENERATE_STUB)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    const response: GenerateResponse = await project.generate({
      entity: 'blacksmith',
      player: 'alice',
      prompt: 'Player returns',
    });

    expect(response.text).toBe('Ah, the Dragon Slayer returns!');
    expect(response.content).toBe(response.text);
    expect(response.contextUsed.eventsReferenced).toBe(3);
    expect(response.tokensUsed.input).toBe(2340);
  });

  it('defaults type to dialogue when not specified', async () => {
    setupMocks([makeResponse(GENERATE_STUB)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.generate({ entity: 'blacksmith', player: 'alice', prompt: 'Hi' });

    const body = getCallBody(1);
    expect(body['type']).toBe('dialogue');
  });

  it('passes explicit type through to API', async () => {
    setupMocks([makeResponse(GENERATE_STUB)]);

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await project.generate({ entity: 'blacksmith', player: 'alice', prompt: 'Summarize', type: 'narration' });

    const body = getCallBody(1);
    expect(body['type']).toBe('narration');
  });
});

describe('Error handling', () => {
  it('throws KiteFrostAuthError on 401', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: 'Unauthorized' }, 401));

    const project = new Project('test-project', { apiKey: 'sk_bad' });
    await expect(project.entity('x', { type: 'npc', name: 'X' })).rejects.toThrow(KiteFrostAuthError);
  });

  it('throws KiteFrostApiError on 500', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201))
      .mockResolvedValueOnce(makeResponse({ error: 'Internal Server Error' }, 500));

    const project = new Project('test-project', { apiKey: 'sk_test' });
    await expect(project.entity('x', { type: 'npc', name: 'X' })).rejects.toThrow(KiteFrostApiError);
  });

  it('includes status code and code in error', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ error: 'Bad request', code: 'INVALID_NAME' }, 400));

    const project = new Project('test-project', { apiKey: 'sk_bad' });
    let caught: unknown;
    try {
      await project.entity('x', { type: 'npc', name: 'X' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(KiteFrostApiError);
    const apiErr = caught as KiteFrostApiError;
    expect(apiErr.statusCode).toBe(400);
    expect(apiErr.code).toBe('INVALID_NAME');
  });
});

describe('Authorization header', () => {
  it('sends Bearer token in Authorization header', async () => {
    setupMocks([makeResponse(ENTITY_STUB, 201)]);

    const project = new Project('test-project', { apiKey: 'sk_mykey' });
    await project.entity('x', { type: 'npc', name: 'X' });

    const headers = getCallHeaders(0);
    expect(headers['Authorization']).toBe('Bearer sk_mykey');
  });
});

describe('Hello project pattern from task spec', () => {
  it('executes the documented hello project flow end-to-end', async () => {
    mockFetch
      .mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201))    // project creation
      .mockResolvedValueOnce(makeResponse(ENTITY_STUB, 201))     // entity
      .mockResolvedValueOnce(makeResponse(EVENT_STUB, 201))      // event
      .mockResolvedValueOnce(makeResponse(GENERATE_STUB));       // generate

    const project = new Project('medieval-rpg', { apiKey: 'sk_test' });

    await project.entity('blacksmith', { type: 'npc', name: 'Gideon', personality: 'gruff but kind' });
    await project.event('player.bought_sword', {
      entity: 'blacksmith',
      player: 'alice',
      details: 'haggled to 35 gold',
    });
    const response = await project.generate({
      entity: 'blacksmith',
      player: 'alice',
      prompt: 'Player returns',
    });

    expect(response.text).toBe('Ah, the Dragon Slayer returns!');
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});
