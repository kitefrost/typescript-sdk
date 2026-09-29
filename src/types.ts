// Core types for @kitefrost/sdk

export interface ProjectOptions {
  apiKey: string;
  baseUrl?: string;
  /** Send anonymous crash telemetry (default true). */
  reportErrors?: boolean;
  /** Include request body in telemetry (default false). */
  reportContext?: boolean;
}

export interface ProjectConfig {
  name: string;
  description?: string;
  settings?: {
    genre?: string;
    tone?: string;
    byokProvider?: string;
    [key: string]: unknown;
  };
}

export interface ProjectMeta {
  id: string;
  /**
   * URL-safe per-tenant identifier used in dashboard routes.
   * Optional for backwards compatibility with pre-slug API responses;
   * new responses always include it.
   */
  slug?: string;
  name: string;
  createdAt: string;
}

export interface EntityProperties {
  type: string;
  name: string;
  [key: string]: unknown;
}

export interface EntityResult {
  id: string;
  externalId: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  projectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface EntityListResult {
  entities: EntityResult[];
  total: number;
}

/**
 * Flat per-type entity resource accessor (entity-api-shape SDK ergonomics).
 * Exposed on the client as `project.npcs`, `project.places`, etc. - one
 * accessor per canonical entity type, each delegating to the generic
 * `entity()` upsert so the request shape stays identical.
 */
export interface EntityResource {
  /** Upsert an entity of this accessor's canonical type. */
  create(externalId: string, properties: EntityProperties): Promise<EntityResult>;
  /** List entities of this type for the project. */
  list(): Promise<EntityListResult>;
  /** Fetch a single entity of this type by its external id. */
  get(externalId: string): Promise<EntityResult>;
}

export interface EventData {
  entity?: string | EntityResult;
  player?: string;
  [key: string]: unknown;
}

export interface EventResult {
  id: string;
  type: string;
  projectId: string;
  createdAt: string;
}

export interface ContextQuery {
  query?: string;
  entityId?: string;
  sinceSession?: number;
}

export interface ContextResult {
  entity?: Record<string, unknown>;
  relevantEvents: Array<{
    type: string;
    data: Record<string, unknown>;
    session?: number;
  }>;
  facts: Array<{
    subject: string;
    predicate: string;
    object: string;
    sinceSession?: number;
  }>;
  summary?: string;
}

export interface GenerateRequest {
  entity: string | EntityResult;
  player: string;
  prompt: string;
  type?: 'dialogue' | 'narration' | 'summary';
}

export interface GenerateResponse {
  text: string;
  content: string;
  contextUsed: {
    eventsReferenced: number;
    factsReferenced: number;
  };
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface TellResponse {
  /** Whether the engine successfully parsed and understood the statement. */
  understood: boolean;
  /** Actions that were parsed and persisted (entity upserts, events recorded, etc.). */
  actions: Array<Record<string, unknown>>;
  /** External IDs of entities mentioned in the statement. */
  entitiesReferenced: string[];
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface AskOptions {
  /**
   * External entity ID whose perspective and voice to use for the
   * ``inCharacter`` response field.  Omit for a plain factual answer.
   */
  respondAs?: string;
}

export interface AskResponse {
  /** Factual summary answer drawn from project memory. */
  answer: string;
  /**
   * In-character response voiced by the ``respondAs`` entity, or
   * ``undefined`` if no entity was specified.
   */
  inCharacter?: string;
  contextUsed: {
    eventsReferenced: number;
    factsReferenced: number;
  };
  tokensUsed: {
    input: number;
    output: number;
  };
}

export interface KiteFrostError {
  error: string;
  code?: string;
  statusCode: number;
}

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface Job {
  id: string;
  status: JobStatus;
  projectId: string;
  type: string;
  result?: Record<string, unknown>;
  error?: string;
  createdAt?: string;
  completedAt?: string;
}

export interface JobListResult {
  jobs: Job[];
  total: number;
}

export interface SubmitJobRequest {
  type?: string;
  prompt: string;
  entityId?: string;
  playerId?: string;
  [key: string]: unknown;
}

export interface JobStreamEvent {
  event: string;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Checkpoint types
// ---------------------------------------------------------------------------

export interface CheckpointResult {
  /** Checkpoint ID (chk_ prefixed). */
  id: string;
  projectId: string;
  name: string;
  description?: string;
  /** sequence_num watermark at checkpoint creation time. */
  eventSequenceNum: number;
  createdAt: string;
  createdBy: string;
}

export interface CheckpointListResult {
  checkpoints: CheckpointResult[];
  total: number;
}

export interface RestoreResult {
  checkpointId: string;
  projectId: string;
  eventsReverted: number;
  auditEventId: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Note types
// ---------------------------------------------------------------------------

export interface NoteOptions {
  /** Free-form note body (markdown). */
  body?: string;
  /** Note classification (e.g. "lore", "todo", "session-log"). */
  noteType?: string;
  /** Whether the note is pinned to the top of the list. */
  pinned?: boolean;
  /** Arbitrary string tags for filtering. */
  tags?: string[];
}

export interface NoteUpdate {
  title?: string;
  body?: string;
  noteType?: string;
  pinned?: boolean;
  tags?: string[];
}

export interface NoteResult {
  id: string;
  projectId: string;
  title: string;
  body?: string;
  noteType?: string;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NoteListResult {
  notes: NoteResult[];
  total: number;
}

// ---------------------------------------------------------------------------
// Quest types
// ---------------------------------------------------------------------------

export interface QuestOptions {
  /** Short summary of the quest. */
  summary?: string;
  /** Quest status (e.g. "active", "completed", "failed"). */
  status?: string;
  /** Ordered list of objective strings. */
  objectives?: string[];
  /** Arbitrary string tags for filtering. */
  tags?: string[];
  [key: string]: unknown;
}

export interface QuestResult {
  id: string;
  projectId: string;
  title: string;
  summary?: string;
  status?: string;
  objectives: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface QuestListResult {
  quests: QuestResult[];
  total: number;
}

// Pack-catalogue types (PackInfo / PackListResult / PacksSelectorPrompt) were
// removed: pack DISCOVERY is an AI-agent runtime concern (REST + MCP), not part
// of the human dev-time SDK surface.

// ---------------------------------------------------------------------------
// Feedback types
// ---------------------------------------------------------------------------

export type FeedbackSignal = 'error_telemetry' | 'bug_report' | 'quality_rating';

export interface FeedbackResult {
  feedbackId: string;
  receivedAt: string;
}

// ---------------------------------------------------------------------------
// VTT import types
// ---------------------------------------------------------------------------

export type VttImportFormat = 'foundry' | 'foundry_json' | 'roll20';

// ---------------------------------------------------------------------------
// Continuity types
// ---------------------------------------------------------------------------

export interface ConsistencyReport {
  findings: Array<Record<string, unknown>>;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Export types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Restrict the export to a single entity (by external id). */
  entityId?: string;
  /** Pack/format-specific export options. */
  options?: Record<string, unknown>;
}

export interface ExportResult {
  format: string;
  content: string;
  packName: string;
  entityId?: string;
  warnings: string[];
}
