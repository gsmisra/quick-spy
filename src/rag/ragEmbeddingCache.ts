import { EmbeddingProvider } from './ragEmbeddingProvider';
import { hashSourceContent } from './ragSourceIdentity';

/**
 * Content-hash-keyed cache wrapping any `EmbeddingProvider` (Phase 6) — a
 * real semantic provider is a network call, and the SAME recipe corpus
 * text gets re-embedded on every retrieval unless something remembers the
 * result; this is that something. Keyed by `hashSourceContent()` (SHA-256)
 * of the exact text embedded, not by recipe id/index, so it stays correct
 * even if a caller re-orders or re-batches its inputs, and a genuinely
 * unchanged recipe's embedding is reused even across a full corpus
 * re-index (only the recipes that actually changed text incur a fresh
 * call).
 *
 * Deliberately a plain in-memory `Map` — scoped to one extension-host
 * session, same durability as `ragIndexer.ts`'s own index cache — not
 * persisted to disk; the corpus is small enough (dozens to a few hundred
 * recipes) that re-warming this once per session is a small, one-time
 * cost, and avoiding a persisted-cache invalidation/staleness story (which
 * recipe changed since the cache file was written? which provider/model
 * produced these vectors?) keeps this simple and unambiguously correct.
 *
 * Pure enough to unit-test directly: takes any `EmbeddingProvider`
 * (including a hand-built fake counting its own calls), so cache hit/miss
 * behavior is verified without any real network access.
 *
 * A12: maintains TWO SEPARATE cache namespaces — one for `embedDocuments()`,
 * one for `embedQuery()` — rather than one shared `Map` keyed purely by
 * content hash. A real embedding provider is not required to (and several
 * real, common ones do NOT) return the same vector for the identical text
 * depending on whether it's asked to embed it as a QUERY or as a DOCUMENT
 * — instruction-tuned/asymmetric models (E5, BGE, and others) prepend a
 * different task-specific instruction internally, and APIs like Cohere's
 * `embed` expose a distinct `input_type` for exactly this reason. A single
 * shared cache used to mean: the moment some text was embedded as a
 * document (the common case — every recipe body, at index time) and LATER
 * happened to also be passed to `embedQuery()` (a user's query string
 * coincidentally matching, or simply the SAME text reaching both paths for
 * any reason), `embedQuery()` returned the DOCUMENT vector straight from
 * cache — silently, with no error — NEVER actually calling
 * `inner.embedQuery()` at all, even on that very first "miss." An
 * asymmetric provider's OWN query-specific embedding logic was therefore
 * structurally unreachable through this cache. The shipped
 * `HttpEmbeddingProvider` happens to use the identical operation for both
 * today, so this was a real interface/capability bug rather than a
 * demonstrated quality regression against that ONE current adapter — but
 * the whole point of the pluggable `EmbeddingProvider` interface is to
 * support providers that legitimately differ here.
 */
export class CachingEmbeddingProvider implements EmbeddingProvider {
  readonly id: string;
  private readonly documentCache = new Map<string, number[]>();
  private readonly queryCache = new Map<string, number[]>();

  constructor(private readonly inner: EmbeddingProvider) {
    this.id = `cached:${inner.id}`;
  }

  /** Total number of distinct cached vectors ACROSS both namespaces —
   * exposed for diagnostics/tests, not part of the `EmbeddingProvider`
   * interface itself. The identical text cached in BOTH namespaces (a
   * genuinely asymmetric provider, or simply the same text reaching both
   * paths) counts as 2 here — each namespace holds its own real, possibly
   * DIFFERENT vector, never deduplicated against each other. */
  get size(): number {
    return this.documentCache.size + this.queryCache.size;
  }

  /** Drops every cached vector in BOTH namespaces — exposed for tests and
   * for a future explicit "re-embed everything" affordance (e.g. after
   * switching provider/model, where old vectors would be from a DIFFERENT
   * embedding space entirely and must never be reused — see
   * rag/ragHybridConfig.ts's own provider-identity cache-key, which already
   * avoids this by building a NEW `CachingEmbeddingProvider` instance
   * whenever the configured endpoint/model/key actually changes, rather
   * than relying on this method being called; this method's own isolation
   * guarantee is otherwise unaffected by the query/document split above —
   * a config change still throws away BOTH namespaces together, exactly as
   * it threw away the one shared cache before this fix). */
  clear(): void {
    this.documentCache.clear();
    this.queryCache.clear();
  }

  async embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const results = new Array<number[]>(texts.length);
    const missingIndexes: number[] = [];
    const missingTexts: string[] = [];

    texts.forEach((text, i) => {
      const cached = this.documentCache.get(hashSourceContent(text));
      if (cached) {
        results[i] = cached;
      } else {
        missingIndexes.push(i);
        missingTexts.push(text);
      }
    });

    if (missingTexts.length > 0) {
      const fresh = await this.inner.embedDocuments(missingTexts, signal);
      if (fresh.length !== missingTexts.length) {
        throw new Error(`CachingEmbeddingProvider: underlying provider "${this.inner.id}" returned ${fresh.length} vector(s) for ${missingTexts.length} text(s).`);
      }
      missingIndexes.forEach((originalIndex, j) => {
        const vector = fresh[j];
        results[originalIndex] = vector;
        this.documentCache.set(hashSourceContent(missingTexts[j]), vector);
      });
    }

    return results;
  }

  async embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
    const key = hashSourceContent(text);
    const cached = this.queryCache.get(key);
    if (cached) {
      return cached;
    }
    // A12: delegates DIRECTLY to `inner.embedQuery()` — never routes a
    // cache miss through `embedDocuments()`/`inner.embedDocuments()` (the
    // fix's core: an asymmetric provider's own query-specific embedding
    // logic is now genuinely reachable, not silently bypassed).
    const vector = await this.inner.embedQuery(text, signal);
    this.queryCache.set(key, vector);
    return vector;
  }
}
