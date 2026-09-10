/**
 * The pluggable SEMANTIC embedding interface for Phase 6's optional hybrid
 * retrieval — deliberately independent of `@langchain/core`'s own
 * `Embeddings` base class (unlike `tfidfEmbeddings.ts`): a real semantic
 * provider is virtually always an ASYNC NETWORK CALL to an external
 * service, not local arithmetic, so this interface exists to make that
 * boundary explicit and swappable, never to imply this extension bundles
 * or requires one.
 *
 * NOTHING in this codebase constructs a concrete implementation of this
 * interface unless a user has EXPLICITLY configured one (endpoint, model,
 * optionally an API key — see the Settings panel's "Hybrid Retrieval"
 * section and rag/ragHybridConfig.ts) — satisfying this project's own
 * "semantic mode must be explicitly configured; never silently upload the
 * corpus to a new service" constraint. Lexical (TF-IDF) retrieval remains
 * fully functional offline with zero configuration, exactly as before this
 * phase; hybrid mode is strictly additive and opt-in.
 */
export interface EmbeddingProvider {
  /** Stable identifier for logging/cache-scoping — should uniquely
   * identify the (endpoint, model) pair this instance was built from, so
   * two providers pointed at different configurations are never confused
   * with each other. */
  readonly id: string;
  /** Embeds a single query string.
   *
   * `signal` (A10) — a plain, web-standard `AbortSignal` rather than a
   * `vscode.CancellationToken`, so this interface (and every pure module
   * that consumes it — ragHybridRetriever.ts, ragEmbeddingCache.ts) stays
   * completely `vscode`-free; the ONE vscode-aware boundary
   * (rag/ragHybridConfig.ts) bridges a real `vscode.CancellationToken`
   * into a plain `AbortSignal` once, for every caller. An implementation
   * that performs a real network call (rag/ragHttpEmbeddingProvider.ts)
   * MUST both honor an aborted/aborting `signal` (stopping the underlying
   * request rather than letting it run to completion pointlessly) AND
   * apply its OWN bounded timeout regardless of whether a `signal` was
   * even given — a caller with no cancellation source of its own is still
   * entitled to never have a single stalled request hang forever. Optional
   * so a fake/local implementation (tests, TfIdfEmbeddings-style local
   * arithmetic) never needs to acknowledge it at all. */
  embedQuery(text: string, signal?: AbortSignal): Promise<number[]>;
  /** Embeds a batch of documents — an implementation SHOULD batch this
   * into as few underlying network calls as its provider's API allows,
   * rather than looping `embedQuery()` once per document, since this is
   * typically called once per corpus recipe. See `embedQuery()`'s own doc
   * comment for what `signal` means and why it's a plain `AbortSignal`. */
  embedDocuments(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}
