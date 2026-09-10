import type { RagIndex } from './ragIndexBuilder';
import type { RagAutomationMode, RagLanguage } from './ragTypes';
import { retrieveRagMatches, RagMatch } from './ragRetriever';
import type { RagOperation } from './ragOperationPlanner';

/**
 * Retrieves candidates INDEPENDENTLY per operation (Phase 3) — the fix for
 * a single whole-query retrieval call (capped at `topK`, currently 2 — see
 * ragRetriever.ts's own doc comment) being unable to surface 3+ DIFFERENT
 * required capabilities for one request. Each operation gets its own
 * `retrieveRagMatches()` call (same hard language filter, same
 * automationMode soft-preference reranking, same lexical improvements —
 * nothing about single-operation retrieval itself changes here), and
 * results are deduplicated by capability ID while recording EVERY
 * operation a given capability actually helps satisfy — a helper useful
 * for two different operations is one candidate, not two.
 */

export interface OperationRagCandidate {
  match: RagMatch;
  /** Every operation ID this candidate scored positively for — a
   * capability useful for multiple operations keeps all of them, so
   * packing (ragOperationPacking.ts) can credit it toward covering
   * whichever of those operations aren't already covered by something
   * else. */
  coveredOperationIds: string[];
  /** The highest score this candidate achieved across all the operations
   * it matched — used only as a relevance tie-breaker during packing, not
   * as a claim comparable across different queries/operations. */
  bestScore: number;
}

/** How many raw matches to pull PER OPERATION — deliberately smaller than
 * the old whole-query `topK` default (2) would need to be for a
 * multi-operation request, since covering N operations no longer depends
 * on cramming N winners into one shared top-2 window; each operation gets
 * its own. A modest per-operation `k` (default 3) still lets a
 * correctly-moded-but-lower-raw-score candidate compete within ONE
 * operation's own reranking, same reasoning as ragRetriever.ts's
 * `CANDIDATE_POOL_SIZE` doc comment, just scoped to a single operation
 * instead of the whole corpus. */
const DEFAULT_PER_OPERATION_K = 3;

/** The shape of `retrieveRagMatches()` itself — factored out so
 * `retrieveForOperations()` can accept an alternative retrieval function
 * (Phase 6: `rag/ragHybridRetriever.ts`'s `retrieveHybridMatches()`, bound
 * to a configured `EmbeddingProvider` — see rag/ragHybridConfig.ts) while
 * defaulting to plain lexical retrieval, with ZERO behavior change for
 * every existing caller that doesn't pass one.
 *
 * `staleFilePaths` (A08, optional — 6th param): every implementation this
 * type is bound to (`retrieveRagMatches()`, and hybrid retrieval via
 * ragHybridConfig.ts's adapter) applies this the SAME way — excluded
 * BEFORE its own internal topK/embedding step, never merely filtered out
 * of the returned list afterward — so `retrieveForOperations()` can thread
 * ONE eligibility policy through whichever retrieval mode is actually
 * active, uniformly. */
export type RetrieveMatchesFn = (
  index: RagIndex,
  queryText: string,
  language: RagLanguage,
  automationMode: RagAutomationMode,
  k: number,
  staleFilePaths?: ReadonlySet<string>
) => Promise<RagMatch[]>;

/** The actual default bound to `retrieveForOperations()`'s own
 * `retrieveMatches` parameter below — a thin adapter, NOT `retrieveRagMatches`
 * directly, because `retrieveRagMatches()`'s own 6th positional parameter is
 * `gateConfig` (an established, still-real parameter with its OWN existing
 * positional callers elsewhere — see that function's own doc comment),
 * never `staleFilePaths`. This preserves `retrieveRagMatches()`'s exact
 * original default gate (`DEFAULT_RELEVANCE_GATE`, applied implicitly by
 * omitting it here) while still correctly forwarding `staleFilePaths` into
 * `retrieveRagMatches()`'s real (7th) parameter for it. */
const defaultRetrieveMatches: RetrieveMatchesFn = (index, queryText, language, automationMode, k, staleFilePaths) =>
  retrieveRagMatches(index, queryText, language, automationMode, k, undefined, staleFilePaths);

/** Runs `retrieveMatches` (defaulting to lexical-only `retrieveRagMatches()`)
 * once per operation and merges the results into one deduplicated
 * candidate list. Returns candidates in NO particular priority order
 * (score-descending within an operation's own contribution, but
 * interleaved across operations by processing order) —
 * ragOperationPacking.ts's own coverage-aware ordering decides what
 * actually gets included, this function's only job is "gather every real
 * candidate exactly once."
 *
 * `staleFilePaths` (A08) is passed straight through to `retrieveMatches`
 * for EVERY operation — each operation's own retrieval excludes a known
 * stale/missing recipe BEFORE its own `perOperationK` cut, rather than the
 * caller (agenticModeController.ts, objectSpyPanel.ts) discarding it from
 * an ALREADY-truncated result afterward, which is the reproduced gap this
 * closes: with `perOperationK` 3, four equally-matching recipes where the
 * top three happen to be stale and the fourth is fresh used to retrieve
 * exactly the three stale ones (the fresh one never even considered), so
 * post-hoc filtering was left with nothing — even though a fresh, indexed
 * helper genuinely existed and should have been used. Optional; omitting
 * it (or passing an empty set) excludes nothing, today's exact prior
 * behavior. */
export async function retrieveForOperations(
  index: RagIndex,
  operations: RagOperation[],
  language: RagLanguage,
  automationMode: RagAutomationMode,
  perOperationK: number = DEFAULT_PER_OPERATION_K,
  retrieveMatches: RetrieveMatchesFn = defaultRetrieveMatches,
  staleFilePaths?: ReadonlySet<string>
): Promise<OperationRagCandidate[]> {
  const byId = new Map<string, OperationRagCandidate>();
  for (const operation of operations) {
    const matches = await retrieveMatches(index, operation.text, language, automationMode, perOperationK, staleFilePaths);
    for (const match of matches) {
      const existing = byId.get(match.id);
      if (existing) {
        if (!existing.coveredOperationIds.includes(operation.operationId)) {
          existing.coveredOperationIds.push(operation.operationId);
        }
        existing.bestScore = Math.max(existing.bestScore, match.score);
      } else {
        byId.set(match.id, { match, coveredOperationIds: [operation.operationId], bestScore: match.score });
      }
    }
  }
  return Array.from(byId.values());
}
