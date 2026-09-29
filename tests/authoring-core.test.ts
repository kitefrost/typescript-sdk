/**
 * Unit tests for the authoring-core endpoints added to the Project class.
 * Uses fetch mocking - no network calls.
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Project } from '../src/project';

// ---------------------------------------------------------------------------
// Fetch mock helpers (mirrors tests/project.test.ts)
// ---------------------------------------------------------------------------

function makeResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: 'http://mock',
    json: async () => body,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
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

// first call is always project creation
function setupMocks(responses: Response[]): void {
  mockFetch.mockResolvedValueOnce(makeResponse(PROJECT_STUB, 201));
  for (const r of responses) {
    mockFetch.mockResolvedValueOnce(r);
  }
}

function getCallBody(callIndex: number): Record<string, unknown> {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(call[1].body as string) as Record<string, unknown>;
}

function getCallUrl(callIndex: number): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[0];
}

function getCallMethod(callIndex: number): string {
  const call = mockFetch.mock.calls[callIndex] as [string, RequestInit];
  return call[1].method as string;
}

function newProject(): Project {
  return new Project('test-project', { apiKey: 'sk_test', reportErrors: false });
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

const NOTE_STUB = {
  id: 'note_001',
  project_id: 'prj_test',
  title: 'Lore note',
  body: 'The kingdom fell.',
  note_type: 'lore',
  pinned: true,
  tags: ['history'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Project.createNote()', () => {
  it('POSTs to /projects/{pid}/notes with mapped body', async () => {
    setupMocks([makeResponse(NOTE_STUB, 201)]);

    const project = newProject();
    const note = await project.createNote('Lore note', {
      body: 'The kingdom fell.',
      noteType: 'lore',
      pinned: true,
      tags: ['history'],
    });

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/notes$/);
    const body = getCallBody(1);
    expect(body['title']).toBe('Lore note');
    expect(body['note_type']).toBe('lore');
    expect(body['pinned']).toBe(true);
    expect(note.id).toBe('note_001');
    expect(note.noteType).toBe('lore');
    expect(note.pinned).toBe(true);
  });
});

describe('Project.listNotes()', () => {
  it('GETs /projects/{pid}/notes and maps results', async () => {
    setupMocks([makeResponse({ notes: [NOTE_STUB], total: 1 })]);

    const project = newProject();
    const result = await project.listNotes();

    expect(getCallMethod(1)).toBe('GET');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/notes$/);
    expect(result.total).toBe(1);
    expect(result.notes[0].projectId).toBe('prj_test');
  });
});

describe('Project.getNote()', () => {
  it('GETs /projects/{pid}/notes/{noteId}', async () => {
    setupMocks([makeResponse(NOTE_STUB)]);

    const project = newProject();
    const note = await project.getNote('note_001');

    expect(getCallMethod(1)).toBe('GET');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/notes\/note_001$/);
    expect(note.title).toBe('Lore note');
  });
});

describe('Project.updateNote()', () => {
  it('PATCHes /projects/{pid}/notes/{noteId} with mapped fields', async () => {
    setupMocks([makeResponse({ ...NOTE_STUB, title: 'Renamed' })]);

    const project = newProject();
    const note = await project.updateNote('note_001', { title: 'Renamed', pinned: false });

    expect(getCallMethod(1)).toBe('PATCH');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/notes\/note_001$/);
    const body = getCallBody(1);
    expect(body['title']).toBe('Renamed');
    expect(body['pinned']).toBe(false);
    expect(note.title).toBe('Renamed');
  });
});

describe('Project.deleteNote()', () => {
  it('DELETEs /projects/{pid}/notes/{noteId} and resolves on 204', async () => {
    setupMocks([makeResponse(undefined, 204)]);

    const project = newProject();
    await expect(project.deleteNote('note_001')).resolves.toBeUndefined();

    expect(getCallMethod(1)).toBe('DELETE');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/notes\/note_001$/);
  });
});

// ---------------------------------------------------------------------------
// Quests
// ---------------------------------------------------------------------------

const QUEST_STUB = {
  id: 'quest_001',
  project_id: 'prj_test',
  title: 'Slay the dragon',
  summary: 'A great evil stirs.',
  status: 'active',
  objectives: ['Find the lair'],
  tags: ['main'],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

describe('Project.createQuest()', () => {
  it('POSTs to /projects/{pid}/quests with mapped body', async () => {
    setupMocks([makeResponse(QUEST_STUB, 201)]);

    const project = newProject();
    const quest = await project.createQuest('Slay the dragon', {
      summary: 'A great evil stirs.',
      status: 'active',
      objectives: ['Find the lair'],
      tags: ['main'],
    });

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/quests$/);
    const body = getCallBody(1);
    expect(body['title']).toBe('Slay the dragon');
    expect(body['status']).toBe('active');
    expect(quest.id).toBe('quest_001');
    expect(quest.objectives).toEqual(['Find the lair']);
  });
});

describe('Project.listQuests()', () => {
  it('GETs /projects/{pid}/quests and maps results', async () => {
    setupMocks([makeResponse({ quests: [QUEST_STUB], total: 1 })]);

    const project = newProject();
    const result = await project.listQuests();

    expect(getCallMethod(1)).toBe('GET');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/quests$/);
    expect(result.total).toBe(1);
    expect(result.quests[0].title).toBe('Slay the dragon');
  });
});

// listPacks / packsSelectorPrompt SDK methods were removed - pack discovery is
// an AI-agent REST/MCP concern, not part of the human dev-time SDK surface.

// ---------------------------------------------------------------------------
// Feedback (public, no project scope)
// ---------------------------------------------------------------------------

describe('Project.submitFeedback()', () => {
  it('POSTs /feedback with schema_version and mapped result', async () => {
    mockFetch.mockResolvedValueOnce(
      makeResponse({ feedback_id: 'fbk_123', received_at: '2026-01-01T00:00:00Z' }, 202),
    );

    const project = newProject();
    const result = await project.submitFeedback('bug_report', { description: 'broken' }, { ua: 'x' });

    expect(getCallMethod(0)).toBe('POST');
    expect(getCallUrl(0)).toMatch(/\/feedback$/);
    const body = getCallBody(0);
    expect(body['schema_version']).toBe('1');
    expect(body['signal']).toBe('bug_report');
    expect(body['payload']).toEqual({ description: 'broken' });
    expect(body['context']).toEqual({ ua: 'x' });
    expect(result.feedbackId).toBe('fbk_123');
    expect(result.receivedAt).toBe('2026-01-01T00:00:00Z');
  });
});

describe('Project.feedbackSchema()', () => {
  it('GETs /feedback/schema.json', async () => {
    mockFetch.mockResolvedValueOnce(makeResponse({ type: 'object' }));

    const project = newProject();
    const schema = await project.feedbackSchema();

    expect(getCallMethod(0)).toBe('GET');
    expect(getCallUrl(0)).toMatch(/\/feedback\/schema\.json$/);
    expect(schema['type']).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// VTT import
// ---------------------------------------------------------------------------

describe('Project.importVtt()', () => {
  it('POSTs /projects/{pid}/import/vtt with format and payload', async () => {
    setupMocks([makeResponse({ entities: [], parsed: true })]);

    const project = newProject();
    const result = await project.importVtt('foundry', { actors: [] });

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/import\/vtt$/);
    const body = getCallBody(1);
    expect(body['format']).toBe('foundry');
    expect(body['payload']).toEqual({ actors: [] });
    expect(result['parsed']).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

describe('Project.checkContinuity()', () => {
  it('POSTs the continuity/check endpoint and maps the report', async () => {
    setupMocks([makeResponse({ findings: [{ kind: 'contradiction' }], generated_at: '2026-01-01T00:00:00Z' })]);

    const project = newProject();
    const report = await project.checkContinuity();

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/game-narrative\/continuity\/check$/);
    expect(report.findings).toHaveLength(1);
    expect(report.generatedAt).toBe('2026-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

describe('Project.export()', () => {
  it('POSTs /projects/{pid}/export with mapped body and result', async () => {
    setupMocks([
      makeResponse({
        format: 'ink',
        content: '=== start ===',
        pack_name: 'game-narrative',
        entity_id: 'blacksmith',
        warnings: ['truncated'],
      }),
    ]);

    const project = newProject();
    const result = await project.export('ink', { entityId: 'blacksmith', options: { pretty: true } });

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/export$/);
    const body = getCallBody(1);
    expect(body['format']).toBe('ink');
    expect(body['entity_id']).toBe('blacksmith');
    expect(body['options']).toEqual({ pretty: true });
    expect(result.packName).toBe('game-narrative');
    expect(result.entityId).toBe('blacksmith');
    expect(result.warnings).toEqual(['truncated']);
  });
});

describe('Project.exportFull()', () => {
  it('POSTs /projects/{pid}/export/full and returns an ArrayBuffer', async () => {
    setupMocks([makeResponse(undefined, 200)]);

    const project = newProject();
    const buf = await project.exportFull();

    expect(getCallMethod(1)).toBe('POST');
    expect(getCallUrl(1)).toMatch(/\/projects\/prj_test\/export\/full$/);
    expect(buf).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(buf)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
