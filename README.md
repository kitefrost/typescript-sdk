# @kitefrost/sdk

TypeScript SDK for the KiteFrost API. Thin fetch wrapper - no runtime dependencies.

## Requirements

- Node.js >= 18 (native `fetch`)
- A KiteFrost API key (`sk_...`)

## Installation

```bash
npm install @kitefrost/sdk
```

## Hello project

```typescript
import { Project } from '@kitefrost/sdk';

const project = new Project('medieval-rpg', { apiKey: 'sk_...' });

// Upsert an entity
await project.entity('blacksmith', { type: 'npc', name: 'Gideon' });

// Record an event
await project.event('player.bought_sword', { entity: 'blacksmith', player: 'alice' });

// Generate context-aware content
const response = await project.generate({
  entity: 'blacksmith',
  player: 'alice',
  prompt: 'Player returns to the forge the next morning.',
});

console.log(response.text);
```

## API

> **Not in the SDK: pack discovery.** This SDK is for building on the pack you
> already chose. Enumerating packs or picking one at runtime (the `GET /v1/packs`
> catalogue and the agent selector-prompt) is an AI-agent concern served by the
> REST + MCP API directly, not by the SDK - so there is intentionally no
> `listPacks` / selector-prompt method. Choose your pack at signup; the SDK
> covers everything under it.

### `new Project(name, options)`

Creates a Project client. The project is auto-created on the server the first time you call any method.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | Yes | Unique project name (used as the slug) |
| `options.apiKey` | `string` | Yes | Bearer token (`sk_...`) |
| `options.baseUrl` | `string` | No | Override API base URL (default: `https://api.kitefrost.ai/v1`) |

### `project.entity(externalId, properties)`

Upsert an entity. Idempotent - calling again updates the entity.

```typescript
const npc = await project.entity('blacksmith', {
  type: 'npc',
  name: 'Gideon',
  faction: 'Ironmongers Guild',
});
```

### `project.event(type, data)`

Record an immutable event. Events are appended to the project's event log.

```typescript
await project.event('player.bought_sword', {
  entity: 'blacksmith',   // entity external ID or EntityResult object
  player: 'alice',
  item: 'iron_sword',
  gold_paid: 15,
});
```

### `project.context(query)`

Query the project state for generation context.

```typescript
const ctx = await project.context({
  entityId: 'blacksmith',
  query: 'recent transactions',
  sinceSession: 3,
});

console.log(ctx.summary);
console.log(ctx.relevantEvents);
console.log(ctx.facts);
```

### `project.generate(request)`

Generate context-aware content grounded in project memory.

```typescript
const response = await project.generate({
  entity: 'blacksmith',
  player: 'alice',
  prompt: 'Player asks about the stolen shipment.',
  type: 'dialogue',  // 'dialogue' | 'narration' | 'summary' (default: 'dialogue')
});

console.log(response.text);
console.log(response.contextUsed);  // { eventsReferenced, factsReferenced }
console.log(response.tokensUsed);   // { input, output }
```

### `project.tell(statement)`

Ingest a natural-language statement into project memory. The engine parses the
statement, extracts entities and relationships, and persists them as structured
events and facts.

```typescript
const result = await project.tell("Alice bought a sword from Gideon for 35 gold.");
console.log(result.understood);          // true
console.log(result.actions);             // [{ type: "event.recorded", ... }]
console.log(result.entitiesReferenced);  // ["alice", "gideon"]
console.log(result.tokensUsed);          // { input: 120, output: 45 }
```

### `project.ask(question, options?)`

Ask a natural-language question about project memory. Returns a factual answer
and, optionally, an in-character response voiced by a specific entity.

```typescript
const response = await project.ask(
  "What does Gideon know about Alice?",
  { respondAs: "gideon" }  // optional - entity external ID
);

console.log(response.answer);      // Factual summary from project memory
console.log(response.inCharacter); // In-character response voiced as Gideon
console.log(response.contextUsed); // { eventsReferenced: 3, factsReferenced: 2 }
console.log(response.tokensUsed);  // { input: 980, output: 120 }
```

### `project.create(config?)`

Explicitly create the project with a full config object. Optional - `entity()`, `event()`, `context()`, and `generate()` all auto-create the project on first call.

```typescript
const meta = await project.create({
  description: 'A low-magic medieval kingdom.',
  settings: { genre: 'fantasy', tone: 'gritty' },
});

console.log(meta.id);
```

## Error handling

All errors extend `KiteFrostError` and expose:
- `.statusCode` - HTTP status code
- `.message` - human-readable error description
- `.docUrl` - link to resolution guidance in the KiteFrost docs

### Exception reference

| Class | HTTP status | When thrown |
|-------|-------------|-------------|
| `AuthenticationError` | 401 | Missing or invalid API key |
| `ForbiddenError` | 403 | Key exists but lacks permission for the operation |
| `NotFoundError` | 404 | Project, entity, or resource does not exist |
| `ValidationError` | 422 | Malformed request payload |
| `RateLimitError` | 429 | Too many requests; check `.retryAfter` |
| `ConflictError` | 409 | Conflicting state (e.g. duplicate entity ID) |
| `BudgetExceededError` | 402 | API spend limit reached for the account |
| `InvalidBYOKKeyError` | 401 | BYOK key was rejected by the upstream provider |
| `ContentPolicyViolationError` | 422 | Prompt or content failed moderation |
| `ServiceUnavailableError` | 503 | Server temporarily unavailable |
| `SessionExpiredError` | 410 | Session has expired and cannot be resumed |
| `ServerError` | 5xx | Unexpected server error |

### Basic example

```typescript
import {
  Project,
  KiteFrostError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
} from '@kitefrost/sdk';

try {
  await project.generate({ entity: 'blacksmith', player: 'alice', prompt: 'Hello' });
} catch (err) {
  if (err instanceof AuthenticationError) {
    console.error('Check your API key:', err.message);
    console.error('Help:', err.docUrl);
  } else if (err instanceof NotFoundError) {
    console.error('Resource not found:', err.message);
  } else if (err instanceof RateLimitError) {
    console.error(`Rate limited. Retry after: ${err.retryAfter}s`);
  } else if (err instanceof KiteFrostError) {
    console.error(`API error ${err.statusCode}: ${err.message}`);
  } else {
    throw err;
  }
}
```

### BYOK error handling

When using a Bring Your Own Key (BYOK) configuration, the upstream provider may
reject the key independently of your KiteFrost credentials. Handle both cases:

```typescript
import {
  Project,
  AuthenticationError,
  InvalidBYOKKeyError,
  BudgetExceededError,
  ContentPolicyViolationError,
} from '@kitefrost/sdk';

const project = new Project('my-project', { apiKey: 'sk_...', byokKey: 'sk-openai-...' });

try {
  const response = await project.generate({ entity: 'npc', player: 'alice', prompt: 'Hello' });
} catch (err) {
  if (err instanceof InvalidBYOKKeyError) {
    // The BYOK key was rejected by the upstream provider (e.g. OpenAI).
    // Check the key in your KiteFrost dashboard, then retry.
    console.error('BYOK key rejected:', err.message);
    console.error('Resolution:', err.docUrl);
  } else if (err instanceof AuthenticationError) {
    // KiteFrost API key itself is invalid.
    console.error('KiteFrost auth failed:', err.message);
  } else if (err instanceof BudgetExceededError) {
    console.error('Spend limit reached:', err.message);
  } else if (err instanceof ContentPolicyViolationError) {
    console.error('Content moderation blocked request:', err.message);
  } else {
    throw err;
  }
}
```

## Building

```bash
npm run build      # compile to dist/
npm run typecheck  # type-check without emitting
```

## License

MIT - see [LICENSE](LICENSE).
