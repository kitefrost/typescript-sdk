import { HttpClient, JsonBody } from './http.js';
import {
  resolveReportErrors,
  warnTelemetryEnabledOnce,
  sendTelemetry,
} from './_telemetry.js';
import { KiteFrostApiError } from './errors.js';
import {
  ProjectOptions,
  ProjectConfig,
  ProjectMeta,
  EntityProperties,
  EntityResult,
  EntityResource,
  EventData,
  EventResult,
  ContextQuery,
  ContextResult,
  GenerateRequest,
  GenerateResponse,
  TellResponse,
  AskOptions,
  AskResponse,
  CheckpointResult,
  CheckpointListResult,
  RestoreResult,
  Job,
  JobListResult,
  SubmitJobRequest,
  JobStreamEvent,
  NoteOptions,
  NoteUpdate,
  NoteResult,
  NoteListResult,
  QuestOptions,
  QuestResult,
  QuestListResult,
  FeedbackSignal,
  FeedbackResult,
  VttImportFormat,
  ConsistencyReport,
  ExportOptions,
  ExportResult,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.kitefrost.ai/v1';

// Canonical entity types → pack-prefix tail. The SDK always targets
// the `generic` pack because every tenant pack exposes the same five
// universal canonical types via aliases. The literal tails are spelled
// out as full path suffixes (instead of built with `${type}s`) so the
// SDK-parity scanner can match them against the OpenAPI route table.
const ENTITY_PATH_TAILS: Record<string, string> = {
  npc: '/generic/npcs',
  location: '/generic/locations',
  faction: '/generic/factions',
  item: '/generic/items',
  player: '/generic/players',
};

function entityPath(projectId: string, canonicalType: string): string {
  const tail = ENTITY_PATH_TAILS[canonicalType];
  if (tail === undefined) {
    throw new Error(
      `Unknown entity type ${JSON.stringify(canonicalType)}. ` +
        `Expected one of: ${Object.keys(ENTITY_PATH_TAILS).sort().join(', ')}.`,
    );
  }
  return `/projects/${projectId}${tail}`;
}

// Raw API response shapes (snake_case from server)
interface RawProjectMeta {
  id: string;
  slug?: string;
  name: string;
  created_at: string;
}

interface RawEntityResult {
  id: string;
  external_id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  project_id: string;
  created_at: string;
  updated_at: string;
}

interface RawEntityListResult {
  entities: RawEntityResult[];
  total: number;
}

function _rawEntityToResult(raw: RawEntityResult): EntityResult {
  return {
    id: raw.id,
    externalId: raw.external_id,
    type: raw.type,
    name: raw.name,
    properties: raw.properties,
    projectId: raw.project_id,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface RawEventResult {
  id: string;
  type: string;
  project_id: string;
  created_at: string;
}

interface RawContextResult {
  entity?: Record<string, unknown>;
  relevant_events: Array<{
    type: string;
    data: Record<string, unknown>;
    session?: number;
  }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    since_session?: number;
  }>;
  summary?: string;
}

interface RawGenerateResponse {
  content: string;
  context_used: {
    events_referenced: number;
    facts_referenced: number;
  };
  tokens_used: {
    input: number;
    output: number;
  };
}

interface RawTellResponse {
  understood: boolean;
  actions: Array<Record<string, unknown>>;
  entities_referenced: string[];
  tokens_used: {
    input: number;
    output: number;
  };
}

interface RawAskResponse {
  answer: string;
  in_character?: string;
  context_used: {
    events_referenced: number;
    facts_referenced: number;
  };
  tokens_used: {
    input: number;
    output: number;
  };
}

interface RawCheckpointResult {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  event_sequence_num: number;
  created_at: string;
  created_by: string;
}

interface RawCheckpointListResult {
  checkpoints: RawCheckpointResult[];
  total: number;
}

interface RawRestoreResult {
  checkpoint_id: string;
  project_id: string;
  events_reverted: number;
  audit_event_id: string;
  message: string;
}

interface RawJob {
  id: string;
  status: string;
  project_id: string;
  type: string;
  result?: Record<string, unknown>;
  error?: string;
  created_at?: string;
  completed_at?: string;
}

interface RawJobListResult {
  jobs: RawJob[];
  total: number;
}

function _rawJobToJob(raw: RawJob): Job {
  return {
    id: raw.id,
    status: raw.status as Job['status'],
    projectId: raw.project_id,
    type: raw.type,
    result: raw.result,
    error: raw.error,
    createdAt: raw.created_at,
    completedAt: raw.completed_at,
  };
}

function resolveExternalId(entityOrId: string | EntityResult): string {
  if (typeof entityOrId === 'string') return entityOrId;
  return entityOrId.externalId;
}

function _rawCheckpointToResult(raw: RawCheckpointResult): CheckpointResult {
  return {
    id: raw.id,
    projectId: raw.project_id,
    name: raw.name,
    description: raw.description,
    eventSequenceNum: raw.event_sequence_num,
    createdAt: raw.created_at,
    createdBy: raw.created_by,
  };
}

interface RawNoteResult {
  id: string;
  project_id: string;
  title: string;
  body?: string;
  note_type?: string;
  pinned?: boolean;
  tags?: string[];
  created_at: string;
  updated_at: string;
}

interface RawNoteListResult {
  notes: RawNoteResult[];
  total: number;
}

function _rawNoteToResult(raw: RawNoteResult): NoteResult {
  return {
    id: raw.id,
    projectId: raw.project_id,
    title: raw.title,
    body: raw.body,
    noteType: raw.note_type,
    pinned: raw.pinned ?? false,
    tags: raw.tags ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface RawQuestResult {
  id: string;
  project_id: string;
  title: string;
  summary?: string;
  status?: string;
  objectives?: string[];
  tags?: string[];
  created_at: string;
  updated_at: string;
}

interface RawQuestListResult {
  quests: RawQuestResult[];
  total: number;
}

function _rawQuestToResult(raw: RawQuestResult): QuestResult {
  return {
    id: raw.id,
    projectId: raw.project_id,
    title: raw.title,
    summary: raw.summary,
    status: raw.status,
    objectives: raw.objectives ?? [],
    tags: raw.tags ?? [],
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

interface RawFeedbackResult {
  feedback_id: string;
  received_at: string;
}

interface RawConsistencyReport {
  findings: Array<Record<string, unknown>>;
  generated_at: string;
}

interface RawExportResult {
  format: string;
  content: string;
  pack_name: string;
  entity_id?: string;
  warnings?: string[];
}

export class Project {
  private readonly http: HttpClient;
  private projectId: string | null = null;
  private readonly projectName: string;
  private readonly _apiKey: string;
  private readonly _reportErrors: boolean;
  private readonly _reportContext: boolean;
  private readonly _baseUrl: string;

  /**
   * Flat per-type entity resource accessors (entity-api-shape SDK
   * ergonomics - NO pack-vocabulary grouping). Each delegates to the
   * generic `entity()` upsert / `/generic/<plural>` routes so the request
   * shape is identical to the canonical-typed API.
   */
  readonly npcs: EntityResource;
  readonly places: EntityResource;
  readonly factions: EntityResource;
  readonly items: EntityResource;
  readonly players: EntityResource;

  constructor(projectName: string, options: ProjectOptions) {
    this.projectName = projectName;
    this._apiKey = options.apiKey;
    this._baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this._reportErrors = resolveReportErrors(options.reportErrors ?? true);
    this._reportContext = options.reportContext ?? false;
    this.http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: this._baseUrl,
    });

    // Flat per-type entity accessors (entity-api-shape decision):
    // project.npcs / project.places / project.factions / project.items /
    // project.players - one accessor per canonical type, all delegating
    // to the generic entity() upsert and /generic/<plural> routes.
    this.npcs = this._entityResource('npc');
    this.places = this._entityResource('location');
    this.factions = this._entityResource('faction');
    this.items = this._entityResource('item');
    this.players = this._entityResource('player');

    if (this._reportErrors) {
      warnTelemetryEnabledOnce(options.apiKey);
    }
  }

  /**
   * Fire-and-forget telemetry for a caught error.
   * Matches the Python SDK's `_send_telemetry` pattern.
   */
  private _sendTelemetry(err: KiteFrostApiError): void {
    if (this._reportErrors) {
      // Intentionally not awaited - fire-and-forget
      void sendTelemetry(err, this._baseUrl, this._reportContext, this._apiKey);
    }
  }

  /**
   * Run an async operation, sending telemetry on KiteFrostApiError.
   */
  private async _withTelemetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof KiteFrostApiError) this._sendTelemetry(err);
      throw err;
    }
  }

  /**
   * Ensure the project exists, creating it if necessary.
   * Caches the project ID after first call.
   */
  private async ensureProject(): Promise<string> {
    if (this.projectId) return this.projectId;

    try {
      const meta = await this.http.post<RawProjectMeta>('/projects', {
        name: this.projectName,
      });
      this.projectId = meta.id;
      return this.projectId;
    } catch (err) {
      if (err instanceof KiteFrostApiError) this._sendTelemetry(err);
      throw err;
    }
  }

  /**
   * Create a project with explicit configuration.
   * Use this when you need fine-grained control; otherwise the constructor
   * auto-creates the project on first API call.
   */
  async create(config?: Partial<ProjectConfig>): Promise<ProjectMeta> {
    const meta = await this.http.post<RawProjectMeta>('/projects', {
      name: this.projectName,
      ...config,
    });
    this.projectId = meta.id;
    return {
      id: meta.id,
      slug: meta.slug,
      name: meta.name,
      createdAt: meta.created_at,
    };
  }

  /**
   * Upsert an entity (NPC, location, faction, item, player...).
   */
  async entity(externalId: string, properties: EntityProperties): Promise<EntityResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const { type, name, ...rest } = properties;
      const raw = await this.http.post<RawEntityResult>(entityPath(pid, type), {
        external_id: externalId,
        name,
        properties: rest,
      });
      return _rawEntityToResult(raw);
    });
  }

  /**
   * Build a flat per-type entity resource accessor bound to one canonical
   * type. `create` reuses the generic `entity()` upsert (identical request
   * shape); `list` / `get` hit the same `/generic/<plural>` routes via
   * `entityPath`.
   */
  private _entityResource(canonicalType: string): EntityResource {
    return {
      create: (externalId: string, properties: EntityProperties) =>
        this.entity(externalId, { ...properties, type: canonicalType }),
      list: () =>
        this._withTelemetry(async () => {
          const pid = await this.ensureProject();
          const raw = await this.http.get<RawEntityListResult>(entityPath(pid, canonicalType));
          return {
            entities: raw.entities.map(_rawEntityToResult),
            total: raw.total,
          };
        }),
      get: (externalId: string) =>
        this._withTelemetry(async () => {
          const pid = await this.ensureProject();
          const raw = await this.http.get<RawEntityResult>(
            `${entityPath(pid, canonicalType)}/${externalId}`,
          );
          return _rawEntityToResult(raw);
        }),
    };
  }

  /**
   * Record an immutable event in the project.
   */
  async event(eventType: string, data: EventData): Promise<EventResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();

      const { entity, player, ...rest } = data;
      const payload: Record<string, unknown> = {
        type: eventType,
        data: rest,
      };

      if (entity !== undefined) {
        payload['entity_id'] = resolveExternalId(entity as string | EntityResult);
      }
      if (player !== undefined) {
        payload['player_id'] = player;
      }

      const raw = await this.http.post<RawEventResult>(`/projects/${pid}/events`, payload);
      return {
        id: raw.id,
        type: raw.type,
        projectId: raw.project_id,
        createdAt: raw.created_at,
      };
    });
  }

  /**
   * Query the project state for generation context.
   * This is the "money endpoint" - retrieves relevant history for an entity/player pair.
   */
  async context(query: ContextQuery): Promise<ContextResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();

      const params: Record<string, string | number | undefined> = {};
      if (query.query) params['query'] = query.query;
      if (query.entityId) params['entity_id'] = query.entityId;
      if (query.sinceSession !== undefined) params['since_session'] = query.sinceSession;

      const raw = await this.http.get<RawContextResult>(`/projects/${pid}/context`, params);
      return {
        entity: raw.entity,
        relevantEvents: raw.relevant_events,
        facts: raw.facts.map((f) => ({
          subject: f.subject,
          predicate: f.predicate,
          object: f.object,
          sinceSession: f.since_session,
        })),
        summary: raw.summary,
      };
    });
  }

  /**
   * Ingest a natural-language statement into project memory.
   *
   * The engine parses the statement, extracts entities and relationships,
   * and persists them as structured events and facts.
   *
   * @param statement - Plain-English description of something that happened.
   *   e.g. `"Alice bought a sword from Gideon for 35 gold."`
   *
   * @example
   * ```typescript
   * const result = await project.tell("Alice bought a sword from Gideon for 35 gold.");
   * console.log(result.understood);          // true
   * console.log(result.actions);             // [{ type: "event.recorded", ... }]
   * console.log(result.entitiesReferenced);  // ["alice", "gideon"]
   * ```
   */
  async tell(statement: string): Promise<TellResponse> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const raw = await this.http.post<RawTellResponse>(`/projects/${pid}/tell`, {
        statement,
      });
      return {
        understood: raw.understood,
        actions: raw.actions,
        entitiesReferenced: raw.entities_referenced,
        tokensUsed: {
          input: raw.tokens_used.input,
          output: raw.tokens_used.output,
        },
      };
    });
  }

  /**
   * Ask a natural-language question about project memory.
   *
   * The engine retrieves relevant context and returns a factual answer.
   * Optionally voices the answer in character as a specific entity.
   *
   * @param question - Plain-English question about the project state.
   *   e.g. `"What does Gideon know about Alice?"`
   * @param options - Optional parameters.
   * @param options.respondAs - External entity ID whose perspective and voice
   *   to use for the `inCharacter` response field.
   *
   * @example
   * ```typescript
   * const response = await project.ask(
   *   "What does Gideon know about Alice?",
   *   { respondAs: "gideon" }
   * );
   * console.log(response.answer);      // Factual summary
   * console.log(response.inCharacter); // In-character response as Gideon
   * ```
   */
  async ask(question: string, options: AskOptions = {}): Promise<AskResponse> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const payload: Record<string, unknown> = { question };
      if (options.respondAs !== undefined) {
        payload['respond_as'] = options.respondAs;
      }
      const raw = await this.http.post<RawAskResponse>(`/projects/${pid}/ask`, payload);
      return {
        answer: raw.answer,
        inCharacter: raw.in_character,
        contextUsed: {
          eventsReferenced: raw.context_used.events_referenced,
          factsReferenced: raw.context_used.facts_referenced,
        },
        tokensUsed: {
          input: raw.tokens_used.input,
          output: raw.tokens_used.output,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Checkpoint methods
  // ---------------------------------------------------------------------------

  /**
   * Create a named checkpoint (snapshot) of the current project state.
   *
   * @param name - Stable checkpoint name (e.g. "before-dragon-fight").
   * @param description - Optional notes about the project state at this point.
   *
   * @example
   * ```typescript
   * const chk = await project.checkpoint("before-dragon-fight");
   * console.log(chk.eventSequenceNum); // 42
   * ```
   */
  async checkpoint(name: string, description?: string): Promise<CheckpointResult> {
    const pid = await this.ensureProject();
    const raw = await this.http.post<RawCheckpointResult>(`/projects/${pid}/checkpoints`, {
      name,
      description,
    });
    return _rawCheckpointToResult(raw);
  }

  /**
   * List checkpoints for this project, newest first.
   *
   * @example
   * ```typescript
   * const { checkpoints } = await project.checkpoints();
   * checkpoints.forEach(c => console.log(c.name, c.eventSequenceNum));
   * ```
   */
  async checkpoints(limit?: number): Promise<CheckpointListResult> {
    const pid = await this.ensureProject();
    const params: Record<string, number> = {};
    if (limit !== undefined) params['limit'] = limit;
    const raw = await this.http.get<RawCheckpointListResult>(`/projects/${pid}/checkpoints`, params);
    return {
      checkpoints: raw.checkpoints.map(_rawCheckpointToResult),
      total: raw.total,
    };
  }

  /**
   * Restore the project to a previously created checkpoint.
   *
   * Events recorded after the checkpoint are soft-deleted (marked reverted=true).
   * Creates a "checkpoint.restored" audit event. Entity state is also restored
   * from the snapshot stored at checkpoint creation time.
   *
   * @param checkpointId - The checkpoint ID (chk_ prefixed) or checkpoint name.
   *   When a name is passed, the most recent checkpoint with that name is used.
   *
   * @example
   * ```typescript
   * const result = await project.restore("chk_abc123");
   * console.log(result.eventsReverted); // 7
   * console.log(result.message);        // "Project reverted to checkpoint 'before-dragon-fight' ..."
   * ```
   */
  async restore(checkpointId: string): Promise<RestoreResult> {
    const pid = await this.ensureProject();

    // If the caller passed a name (no "chk_" prefix), resolve to an ID first.
    let resolvedId = checkpointId;
    if (!checkpointId.startsWith('chk_')) {
      const { checkpoints } = await this.checkpoints(50);
      const match = checkpoints.find((c) => c.name === checkpointId);
      if (!match) {
        throw new Error(`Checkpoint named '${checkpointId}' not found in project '${pid}'`);
      }
      resolvedId = match.id;
    }

    const raw = await this.http.post<RawRestoreResult>(
      `/projects/${pid}/checkpoints/${resolvedId}/restore`,
      {},
    );
    return {
      checkpointId: raw.checkpoint_id,
      projectId: raw.project_id,
      eventsReverted: raw.events_reverted,
      auditEventId: raw.audit_event_id,
      message: raw.message,
    };
  }

  /**
   * Generate context-aware content (dialogue, narration, summary).
   */
  async generate(request: GenerateRequest): Promise<GenerateResponse> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();

      const raw = await this.http.post<RawGenerateResponse>(`/projects/${pid}/generate`, {
        entity_id: resolveExternalId(request.entity),
        player_id: request.player,
        prompt: request.prompt,
        type: request.type ?? 'dialogue',
      });

      return {
        text: raw.content,
        content: raw.content,
        contextUsed: {
          eventsReferenced: raw.context_used.events_referenced,
          factsReferenced: raw.context_used.facts_referenced,
        },
        tokensUsed: {
          input: raw.tokens_used.input,
          output: raw.tokens_used.output,
        },
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Job queue methods
  // ---------------------------------------------------------------------------

  /**
   * Submit an asynchronous generation job.
   *
   * Returns immediately with a Job in "queued" status. Use {@link getJob} or
   * {@link pollJob} to check progress, or {@link streamJob} for real-time SSE.
   *
   * @example
   * ```typescript
   * const job = await project.submitJob({ prompt: "Describe the tavern at dawn." });
   * console.log(job.id, job.status); // "job_abc123" "queued"
   * ```
   */
  async submitJob(request: SubmitJobRequest): Promise<Job> {
    const pid = await this.ensureProject();
    const { type, prompt, entityId, playerId, ...rest } = request;
    const payload: Record<string, unknown> = {
      type: type ?? 'generate',
      prompt,
      ...rest,
    };
    if (entityId !== undefined) payload['entity_id'] = entityId;
    if (playerId !== undefined) payload['player_id'] = playerId;

    const raw = await this.http.post<RawJob>(`/projects/${pid}/generate`, payload);
    return _rawJobToJob(raw);
  }

  /**
   * Fetch the current state of a job by its ID.
   */
  async getJob(jobId: string): Promise<Job> {
    const raw = await this.http.get<RawJob>(`/jobs/${jobId}`);
    return _rawJobToJob(raw);
  }

  /**
   * List jobs for the current API key.
   *
   * @param options.limit - Maximum number of jobs (default 20).
   * @param options.offset - Pagination offset (default 0).
   * @param options.status - Optional status filter.
   */
  async listJobs(options: {
    limit?: number;
    offset?: number;
    status?: string;
  } = {}): Promise<JobListResult> {
    const params: Record<string, string | number | undefined> = {
      limit: options.limit ?? 20,
      offset: options.offset ?? 0,
    };
    if (options.status) params['status'] = options.status;

    const raw = await this.http.get<RawJobListResult>('/jobs', params);
    return {
      jobs: raw.jobs.map(_rawJobToJob),
      total: raw.total,
    };
  }

  /**
   * Cancel a queued or processing job.
   */
  async cancelJob(jobId: string): Promise<Job> {
    const raw = await this.http.delete<RawJob>(`/jobs/${jobId}`);
    return _rawJobToJob(raw);
  }

  /**
   * Poll a job until it reaches a terminal status.
   *
   * @param jobId - The job identifier.
   * @param options.intervalMs - Milliseconds between polls (default 2000).
   * @param options.timeoutMs - Maximum wait in milliseconds (default 600000).
   */
  async pollJob(
    jobId: string,
    options: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<Job> {
    const interval = options.intervalMs ?? 2000;
    const timeout = options.timeoutMs ?? 600_000;
    const deadline = Date.now() + timeout;
    const terminal = new Set(['completed', 'failed', 'cancelled']);

    while (true) {
      const job = await this.getJob(jobId);
      if (terminal.has(job.status)) return job;

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Job ${jobId} did not complete within ${timeout}ms (last status: ${job.status})`,
        );
      }
      await new Promise((r) => setTimeout(r, Math.min(interval, remaining)));
    }
  }

  /**
   * Stream job progress events via Server-Sent Events.
   *
   * Returns an async iterable of SSE events. The stream closes when the job
   * reaches a terminal status.
   *
   * @example
   * ```typescript
   * for await (const event of project.streamJob(job.id)) {
   *   console.log(event.event, event.data);
   * }
   * ```
   */
  async *streamJob(jobId: string): AsyncIterable<JobStreamEvent> {
    const response = await this.http.getRaw(`/jobs/${jobId}/stream`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Response body is not readable');

    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';
    let currentData = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData += line.slice(5).trim();
          } else if (line === '') {
            if (currentData) {
              try {
                const data = JSON.parse(currentData) as Record<string, unknown>;
                yield { event: currentEvent, data };
              } catch {
                yield { event: currentEvent, data: { raw: currentData } };
              }
            }
            currentEvent = 'message';
            currentData = '';
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ---------------------------------------------------------------------------
  // Note methods
  // ---------------------------------------------------------------------------

  /**
   * Create a note attached to this project.
   *
   * @param title - Short note title.
   * @param opts.body - Free-form markdown body.
   * @param opts.noteType - Classification (e.g. "lore", "todo").
   * @param opts.pinned - Pin the note to the top of the list.
   * @param opts.tags - Arbitrary string tags.
   */
  async createNote(title: string, opts: NoteOptions = {}): Promise<NoteResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const payload: Record<string, unknown> = { title };
      if (opts.body !== undefined) payload['body'] = opts.body;
      if (opts.noteType !== undefined) payload['note_type'] = opts.noteType;
      if (opts.pinned !== undefined) payload['pinned'] = opts.pinned;
      if (opts.tags !== undefined) payload['tags'] = opts.tags;
      const raw = await this.http.post<RawNoteResult>(`/projects/${pid}/notes`, payload);
      return _rawNoteToResult(raw);
    });
  }

  /**
   * List notes for this project.
   */
  async listNotes(): Promise<NoteListResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const raw = await this.http.get<RawNoteListResult>(`/projects/${pid}/notes`);
      return {
        notes: raw.notes.map(_rawNoteToResult),
        total: raw.total,
      };
    });
  }

  /**
   * Fetch a single note by its ID.
   */
  async getNote(noteId: string): Promise<NoteResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const raw = await this.http.get<RawNoteResult>(`/projects/${pid}/notes/${noteId}`);
      return _rawNoteToResult(raw);
    });
  }

  /**
   * Update fields on an existing note.
   */
  async updateNote(noteId: string, fields: NoteUpdate): Promise<NoteResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const payload: Record<string, unknown> = {};
      if (fields.title !== undefined) payload['title'] = fields.title;
      if (fields.body !== undefined) payload['body'] = fields.body;
      if (fields.noteType !== undefined) payload['note_type'] = fields.noteType;
      if (fields.pinned !== undefined) payload['pinned'] = fields.pinned;
      if (fields.tags !== undefined) payload['tags'] = fields.tags;
      const raw = await this.http.patch<RawNoteResult>(`/projects/${pid}/notes/${noteId}`, payload);
      return _rawNoteToResult(raw);
    });
  }

  /**
   * Delete a note. Resolves once the server returns 204 No Content.
   */
  async deleteNote(noteId: string): Promise<void> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      await this.http.delete<void>(`/projects/${pid}/notes/${noteId}`);
    });
  }

  // ---------------------------------------------------------------------------
  // Quest methods
  // ---------------------------------------------------------------------------

  /**
   * Create a quest attached to this project.
   *
   * @param title - Quest title.
   * @param opts.summary - Short summary.
   * @param opts.status - Quest status (e.g. "active").
   * @param opts.objectives - Ordered objective strings.
   * @param opts.tags - Arbitrary string tags.
   */
  async createQuest(title: string, opts: QuestOptions = {}): Promise<QuestResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const { summary, status, objectives, tags, ...rest } = opts;
      const payload: Record<string, unknown> = { title, ...rest };
      if (summary !== undefined) payload['summary'] = summary;
      if (status !== undefined) payload['status'] = status;
      if (objectives !== undefined) payload['objectives'] = objectives;
      if (tags !== undefined) payload['tags'] = tags;
      const raw = await this.http.post<RawQuestResult>(`/projects/${pid}/quests`, payload);
      return _rawQuestToResult(raw);
    });
  }

  /**
   * List quests for this project.
   */
  async listQuests(): Promise<QuestListResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const raw = await this.http.get<RawQuestListResult>(`/projects/${pid}/quests`);
      return {
        quests: raw.quests.map(_rawQuestToResult),
        total: raw.total,
      };
    });
  }

  // Pack-catalogue / selector-prompt methods intentionally NOT exposed on the
  // SDK: the SDK is a human developer's dev-time authoring tool (the caller
  // already knows their pack), whereas pack DISCOVERY (list all packs, pick
  // one) is an AI-agent runtime concern served by the REST + MCP surface
  // (GET /v1/packs, /v1/packs/selector-prompt) directly.

  // ---------------------------------------------------------------------------
  // Feedback methods
  // ---------------------------------------------------------------------------

  /**
   * Submit a feedback signal (error telemetry, bug report, quality rating).
   *
   * @param signal - One of "error_telemetry", "bug_report", "quality_rating".
   * @param payload - Signal-specific structured payload.
   * @param context - Optional context block.
   */
  async submitFeedback(
    signal: FeedbackSignal,
    payload: Record<string, unknown>,
    context?: Record<string, unknown>,
  ): Promise<FeedbackResult> {
    return this._withTelemetry(async () => {
      const body: Record<string, unknown> = {
        schema_version: '1',
        signal,
        payload,
      };
      if (context !== undefined) body['context'] = context;
      const raw = await this.http.post<RawFeedbackResult>('/feedback', body);
      return {
        feedbackId: raw.feedback_id,
        receivedAt: raw.received_at,
      };
    });
  }

  /**
   * Fetch the JSON schema describing the feedback payload contract.
   */
  async feedbackSchema(): Promise<Record<string, unknown>> {
    return this._withTelemetry(async () => {
      return this.http.get<Record<string, unknown>>('/feedback/schema.json');
    });
  }

  // ---------------------------------------------------------------------------
  // VTT import methods
  // ---------------------------------------------------------------------------

  /**
   * Parse a VTT export into KiteFrost's canonical shape. Parse-only (does
   * not persist). Pro-gated - a 402 surfaces as a KiteFrostApiError.
   *
   * @param format - One of "foundry", "foundry_json", "roll20".
   * @param payload - The raw VTT export payload to parse.
   */
  async importVtt(
    format: VttImportFormat,
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      return this.http.post<Record<string, unknown>>(`/projects/${pid}/import/vtt`, {
        format,
        payload,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Continuity methods
  // ---------------------------------------------------------------------------

  /**
   * Run a continuity / consistency check over the project state. Free.
   */
  async checkContinuity(): Promise<ConsistencyReport> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const raw = await this.http.post<RawConsistencyReport>(
        `/projects/${pid}/game-narrative/continuity/check`,
        {},
      );
      return {
        findings: raw.findings,
        generatedAt: raw.generated_at,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Export methods
  // ---------------------------------------------------------------------------

  /**
   * Export project content in a pack-specific format.
   *
   * @param format - Target export format.
   * @param opts.entityId - Restrict the export to one entity.
   * @param opts.options - Format-specific options.
   */
  async export(format: string, opts: ExportOptions = {}): Promise<ExportResult> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      const body: Record<string, unknown> = { format };
      if (opts.entityId !== undefined) body['entity_id'] = opts.entityId;
      if (opts.options !== undefined) body['options'] = opts.options;
      const raw = await this.http.post<RawExportResult>(`/projects/${pid}/export`, body);
      return {
        format: raw.format,
        content: raw.content,
        packName: raw.pack_name,
        entityId: raw.entity_id,
        warnings: raw.warnings ?? [],
      };
    });
  }

  /**
   * Export the full project as a ZIP archive, returned as an ArrayBuffer.
   */
  async exportFull(): Promise<ArrayBuffer> {
    return this._withTelemetry(async () => {
      const pid = await this.ensureProject();
      return this.http.postBinary(`/projects/${pid}/export/full`, {});
    });
  }

  /**
   * Execute a raw GraphQL query/mutation against `POST /v1/graphql`.
   *
   * Escape hatch for the GraphQL API (complex nested reads, typed pack
   * mutations, real-time subscriptions). KiteFrost ships no separate GraphQL
   * SDK: fetch the schema from `GET /v1/graphql/schema` and run your own
   * codegen (graphql-codegen) for typed clients. This is thin transport -
   * the same auth and error handling as the REST helpers. GraphQL errors are
   * returned in-band (HTTP 200) in the `errors` array of the envelope.
   *
   * @param query A GraphQL document (query or mutation).
   * @param variables Optional GraphQL variables object.
   * @returns The raw GraphQL response envelope (`{ data, errors }`).
   */
  async graphql<T = unknown>(query: string, variables?: Record<string, unknown>): Promise<T> {
    return this._withTelemetry(async () => {
      const body: JsonBody = variables !== undefined ? { query, variables } : { query };
      return this.http.post<T>('/graphql', body);
    });
  }
}
