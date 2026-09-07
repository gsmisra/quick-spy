/**
 * Small in-process, in-memory TTL cache — no external cache server (Redis or
 * otherwise), no disk persistence. Lives entirely in the extension host's own
 * process memory for the life of that process (cleared on window reload /
 * extension deactivation), which is exactly the "local system memory" this
 * extension is scoped to (see environmentCheck.ts's offline-first stance).
 *
 * Deliberately minimal: TTL expiry plus a bounded size with FIFO eviction
 * (oldest-inserted entry dropped first) so a runaway number of distinct keys
 * (e.g. one token-count entry per distinct prompt) can never grow unbounded.
 * Not an LRU — insertion order, not access order — which is simpler and
 * plenty for these call sites' cardinality.
 */
export class TtlCache<K, V> {
  private readonly store = new Map<K, { value: V; expiresAt: number }>();

  constructor(private readonly maxEntries = 200) {}

  /** Returns the cached value, or `undefined` if missing or expired. An
   * expired entry is deleted on read (lazy eviction — no background timer). */
  get(key: K): V | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, ttlMs: number): void {
    if (!this.store.has(key) && this.store.size >= this.maxEntries) {
      // Map preserves insertion order — the first key yielded is the oldest.
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: K): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}
