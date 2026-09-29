# @kitefrost/core

Shared runtime core for the KiteFrost per-pack SDKs (PPI-3, D-PPI-SDK-BUNDLING
Option A).

It owns the cross-pack infrastructure surface so each per-pack SDK does not
duplicate it:

- HTTP transport
- Auth provider with one-shot 401 refresh
- Typed error hierarchy (`KiteFrostApiError` and subclasses)
- The SHARED_TAGS resource clients (auth, keys, billing, projects, events,
  context, byok, webhooks, health)
- A lockstep version stamp (`CORE_VERSION`) the per-pack SDKs pin

```ts
import { KiteFrostCore } from '@kitefrost/core';

const core = new KiteFrostCore({ apiKey: 'sk_live_...' });
console.log(await core.health.check());
```

When a customer installs more than one per-pack SDK, the packs share a single
`KiteFrostCore` instance, so they share one auth provider and one connection
pool (the Option-A DX win).

## Pre-release (alpha) builds

Alpha and beta builds are published under an npm dist-tag (`alpha`, `beta`, `rc`);
`latest` always stays on the newest stable release, so a plain install never picks
up an alpha:

```bash
npm install @kitefrost/core@alpha @kitefrost/<pack>@alpha
```

To point the client at a non-default API (for example the address in an early-access
invite), pass `baseUrl` when you construct it, or set `KITEFROST_BASE_URL`
(Node). The explicit option wins over the environment variable, which wins over
the default - the same precedence as the Python SDK:

```ts
const core = new KiteFrostCore({ apiKey: 'sk_...', baseUrl: '<address from your invite>' });
```
