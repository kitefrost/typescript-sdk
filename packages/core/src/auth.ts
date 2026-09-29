/**
 * Single auth provider for the shared core.
 *
 * The Option-A DX win (D-PPI-SDK-BUNDLING): when a customer installs more than
 * one per-pack SDK, they all share ONE AuthProvider instance (and therefore one
 * credential + one in-flight refresh), instead of each pack carrying its own
 * token state and issuing redundant refreshes.
 */
export interface AuthProvider {
  /** Current Authorization header value, e.g. `Bearer <token>`. */
  authHeader(): Promise<string>;
  /**
   * Force a one-shot credential refresh after a 401 and return the new
   * Authorization header. Returns null when this provider cannot refresh
   * (static API keys), so the transport surfaces the 401 unchanged.
   */
  refresh(): Promise<string | null>;
}

/** Static API-key auth. Cannot refresh; a 401 is surfaced as KiteFrostAuthError. */
export class ApiKeyAuth implements AuthProvider {
  constructor(private readonly apiKey: string) {}

  async authHeader(): Promise<string> {
    return `Bearer ${this.apiKey}`;
  }

  async refresh(): Promise<string | null> {
    return null;
  }
}

/**
 * Bearer-token auth with one-shot refresh. The refresh callback is invoked at
 * most once per concurrent burst (coalesced) so multiple packs racing a 401 do
 * not each trigger a separate refresh.
 */
export class RefreshableTokenAuth implements AuthProvider {
  private token: string;
  private inflight: Promise<string> | null = null;

  constructor(
    initialToken: string,
    private readonly refreshFn: () => Promise<string>,
  ) {
    this.token = initialToken;
  }

  async authHeader(): Promise<string> {
    return `Bearer ${this.token}`;
  }

  async refresh(): Promise<string | null> {
    if (!this.inflight) {
      this.inflight = (async () => {
        try {
          this.token = await this.refreshFn();
          return this.token;
        } finally {
          this.inflight = null;
        }
      })();
    }
    const fresh = await this.inflight;
    return `Bearer ${fresh}`;
  }
}
