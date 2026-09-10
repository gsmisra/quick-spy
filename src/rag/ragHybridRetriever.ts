import type { RagIndex } from './ragIndexBuilder';
import type { RagAutomationMode, RagLanguage, RagRecipe } from './ragTypes';
import { recipeToEmbeddingText } from './ragTypes';
import { RagMatch, retrieveRagMatches, AUTOMATION_MODE_MISMATCH_PENALTY } from './ragRetriever';
import { EmbeddingProvider } from './ragEmbeddingProvider';
import { DEFAULT_RRF_K, RankedList, reciprocalRankFusion } from './ragReciprocalRankFusion';
import { applyRelevanceGate, DEFAULT_RELEVANCE_GATE, GateCandidate, RelevanceGateConfig } from './ragRelevanceGate';

/**
 * Optional hybrid (lexical + semantic) retrieval — Phase 6. Runs the
 * EXISTING, unchanged lexical pipeline (`retrieveRagMatches()`, full TF-IDF
 * ranking + automationMode soft-preference, at a wide pool size so its full
 * ranking is available for fusion, not just its usual small `topK`) and a
 * PARALLEL semantic ranking (`rankSemanticCandidates()`, driven by a
 * caller-supplied `EmbeddingProvider` — never constructed here, never
 * assumed to exist) side by side, then combines the two RANKINGS (not raw
 * scores — see ragReciprocalRankFusion.ts's own doc comment for why) via
 * Reciprocal Rank Fusion.
 *
 * Strictly additive: nothing in this module runs unless a caller
 * EXPLICITLY passes a real `EmbeddingProvider` (see
 * rag/ragHybridConfig.ts's `resolveHybridRetrieveMatches()`, which only
 * ever produces one when hybrid mode is turned on AND fully configured in
 * Settings) — lexical-only retrieval via `retrieveRagMatches()` itself is
 * completely untouched by this file's existence.
 *
 * `language` remains a HARD filter for both rankers, same as
 * `retrieveRagMatches()` itself. `automationMode` remains a SOFT
 * preference, applied identically to the semantic ranking as the lexical
 * one (`AUTOMATION_MODE_MISMATCH_PENALTY`, reused rather than
 * re-invented) — a real per-source score, penalized BEFORE either list is
 * handed to RRF, so a mode mismatch demotes a candidate's RANK the same
 * way in both rankings prior to fusion.
 */

/** A11: thrown by `cosineSimilarity()` when the two vectors it's asked to
 * compare are genuinely incompatible (different dimensions, empty, or
 * containing a non-finite value) — kept as its own recognizable error type
 * for the SAME reason ragHttpEmbeddingProvider.ts's `EmbeddingTimeoutError`
 * is (A10): a caller (`rankSemanticCandidates()`, and beyond it
 * `retrieveHybridMatches()`'s own A10 catch-and-degrade-to-lexical wiring)
 * treats this exactly like any other non-cancellation semantic failure —
 * report it, fall back to lexical-only — never as a real ranking result. */
export class VectorDimensionMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VectorDimensionMismatchError';
  }
}

/** Cosine similarity between two equal-length, non-empty, finite-valued
 * vectors — REFUSES to compare two incompatible vectors at all, rather
 * than silently truncating both to their shorter length (the OLD
 * behavior, and the exact reproduced A11 bug: `cosineSimilarity([1,0],
 * [1])` used to return `1` — perfect similarity — computed over only the
 * FIRST element of each, discarding `a`'s own second dimension entirely,
 * manufacturing ranking evidence from vectors that were never actually
 * comparable in the first place). Genuinely incompatible vectors can only
 * ever indicate a bug or malformed response somewhere upstream (this
 * codebase's own local `TfIdfEmbeddings` always produces consistent
 * dimensions; a real HTTP `EmbeddingProvider` — ragHttpEmbeddingProvider.ts
 * — validates a single response's own internal consistency, but a
 * misbehaving/nonstandard endpoint returning a DIFFERENT dimensionality
 * across two separate calls, e.g. `embedQuery()` vs `embedDocuments()`,
 * is exactly the cross-call case only a comparison-time check like this
 * one can catch) — "silently produce a number anyway" is never the safe
 * choice; refusing and letting the caller's own semantic-failure handling
 * take over (A10) is. */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new VectorDimensionMismatchError(`Cannot compute cosine similarity between vectors of different dimensions (${a.length} vs ${b.length}).`);
  }
  if (a.length === 0) {
    throw new VectorDimensionMismatchError('Cannot compute cosine similarity between empty vectors.');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) {
      throw new VectorDimensionMismatchError(`Cannot compute cosine similarity — vector contains a non-finite value at position ${i}.`);
    }
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) {
    return 0;
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SemanticCandidate {
  id: string;
  /** Cosine similarity between the query and this recipe's embedding,
   * automationMode penalty already applied — same treatment as
   * `retrieveRagMatches()` gives its own TF-IDF score, computed
   * independently here since this ranking never touches the TF-IDF vector
   * store at all. */
  score: number;
}

/** Ranks every `language`-compatible recipe against `queryText` using
 * `provider`'s own embedding space — entirely independent of the TF-IDF
 * index (`recipeToEmbeddingText()` is reused so both rankers see the SAME
 * underlying text, just embedded differently). Filters out non-positive
 * scores, same convention as `retrieveRagMatches()`'s own default
 * acceptance floor, since a zero-or-negative cosine similarity carries no
 * real ranking signal. Returns an empty list (never throws) for an empty
 * query or a corpus with no `language`-compatible recipe at all.
 *
 * `canonicalIds` must be the SAME length/order as `recipes` (i.e.
 * `index.canonicalIds` from ragIndexBuilder.ts) — every emitted
 * `SemanticCandidate.id` is the recipe's CANONICAL (corpus-wide-deduped)
 * id, never `recipe.frontmatter.id` directly, so that two recipes sharing
 * one raw frontmatter id (see `dedupeRecipeIds()`) are still distinguishable
 * on the semantic side exactly as they already are on the lexical side —
 * without this, both would rank under the identical bare id and
 * `retrieveHybridMatches()` could return one recipe's body mislabeled as
 * the other's ranking evidence (A06).
 *
 * `staleFilePaths` (A08) is excluded from `compatible` BEFORE any embedding
 * happens — never merely filtered out of the RESULT afterward. A stale or
 * missing recipe's own body is never worth spending an embedding-provider
 * call on: it can only ever be discarded downstream, and — for a real HTTP
 * embedding provider (ragHttpEmbeddingProvider.ts) — sending its content
 * out over the network at all is wasted cost and a needless exposure of
 * content this extension already knows is stale, for zero possible
 * benefit. Optional; omitting it (or passing an empty set) excludes
 * nothing, today's exact prior behavior.
 *
 * `signal` (A10) is forwarded to BOTH provider calls unchanged — see
 * `EmbeddingProvider.embedQuery()`'s own doc comment for what it means.
 * This function itself never interprets it (never catches, never
 * distinguishes cancellation from a real failure) — that decision belongs
 * to `retrieveHybridMatches()`, the one caller with enough context (a
 * lexical fallback to degrade to) to make it. */
export async function rankSemanticCandidates(
  recipes: RagRecipe[],
  canonicalIds: string[],
  provider: EmbeddingProvider,
  queryText: string,
  language: RagLanguage,
  automationMode: RagAutomationMode,
  staleFilePaths?: ReadonlySet<string>,
  signal?: AbortSignal
): Promise<SemanticCandidate[]> {
  if (!queryText.trim()) {
    return [];
  }
  const compatible = recipes
    .map((recipe, i) => ({ recipe, canonicalId: canonicalIds[i] }))
    .filter(({ recipe }) => recipe.frontmatter.language.includes(language) && !staleFilePaths?.has(recipe.filePath));
  if (compatible.length === 0) {
    return [];
  }

  const texts = compatible.map(({ recipe }) => recipeToEmbeddingText(recipe));
  const [queryVector, docVectors] = await Promise.all([provider.embedQuery(queryText, signal), provider.embedDocuments(texts, signal)]);

  return compatible
    .map(({ recipe, canonicalId }, i) => {
      const rawScore = cosineSimilarity(queryVector, docVectors[i]);
      const modeMatches = recipe.frontmatter.automationMode.includes(automationMode);
      const score = modeMatches ? rawScore : rawScore * AUTOMATION_MODE_MISMATCH_PENALTY;
      return { id: canonicalId, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** A SEPARATE, independently-named constant from `DEFAULT_RELEVANCE_GATE`
 * (ragRelevanceGate.ts) — same conservative shape (accept anything with a
 * positive fused score, no extra requirement) but deliberately its OWN
 * binding, never a re-export or alias of the lexical default. An RRF fused
 * score lives on a totally different numeric scale than a TF-IDF cosine
 * similarity (typically small fractions like ~0.03 for a rank-1 hit at the
 * standard k=60 — see ragReciprocalRankFusion.ts), so accidentally
 * threading `DEFAULT_RELEVANCE_GATE`'s own `minLexicalScore` (tuned, if
 * ever, against TF-IDF's scale) into a hybrid gate would silently
 * mis-calibrate acceptance. Any future calibration of a NON-zero
 * `minLexicalScore` for hybrid mode must be evaluated against fused-score
 * evidence specifically (see rag/benchmark/ragHybridEvaluationRunner.ts),
 * never inherited from Phase 4's TF-IDF-only calibration work. */
export const DEFAULT_HYBRID_GATE: RelevanceGateConfig = {
  minLexicalScore: 0,
  requireSymbolEvidence: false,
  requireModeCompatibility: false
};

export interface HybridRetrievalOptions {
  /** Final number of matches returned, after fusion + gating — same
   * meaning as `retrieveRagMatches()`'s own `topK`. Default 2. */
  topK?: number;
  /** How many raw candidates EACH individual ranker contributes to fusion
   * — independent of `topK`, and independent of each other (the lexical
   * ranker's own pool is `index.store.size`, i.e. every language-compatible
   * recipe, same as `retrieveRagMatches()`'s own `candidatePoolSize()`
   * reasoning: this corpus is small enough that pooling everything is
   * genuinely free, and a fixed cap here would reintroduce exactly the
   * "a good match ranked just outside the pool never gets a chance" bug
   * that reasoning already documents). */
  rrfK?: number;
  /** Applied AFTER fusion — see `DEFAULT_HYBRID_GATE`'s own doc comment for
   * why this must never be `DEFAULT_RELEVANCE_GATE` itself. */
  gateConfig?: RelevanceGateConfig;
  /** A08: `RagMatch.filePath` values known `stale`/`missing` per Phase 5's
   * active freshness check — excluded from BOTH rankers (lexical AND
   * semantic) BEFORE either one's own topK/embedding step, never merely
   * filtered out of the final fused result. See
   * `retrieveRagMatches()`'s and `rankSemanticCandidates()`'s own doc
   * comments on their identically-named parameter for why "before" matters
   * here — the whole point is that an eligible candidate ranked just
   * outside what either ranker would otherwise have retrieved gets to take
   * an excluded candidate's place, rather than the result just shrinking.
   * Optional; omitting it excludes nothing, today's exact prior
   * behavior. */
  staleFilePaths?: ReadonlySet<string>;
  /** A10: forwarded to the SEMANTIC ranker's provider calls
   * (`rankSemanticCandidates()`) — never to the lexical ranker, which is
   * pure local arithmetic with nothing to cancel. When THIS signal is
   * what causes the semantic ranker to fail (checked via `signal.aborted`
   * after the fact, never by inspecting the thrown error's own shape —
   * see `EmbeddingTimeoutError`'s own doc comment in
   * ragHttpEmbeddingProvider.ts for why), `retrieveHybridMatches()`
   * PROPAGATES that failure — cancellation must stop work, never trigger
   * a fallback of its own. Omitting it (the common case today, until a
   * caller wires a real cancellation source through) simply means a
   * semantic failure is NEVER attributable to caller cancellation, so it
   * always degrades to lexical-only instead — see `onSemanticFailure`'s
   * own doc comment for that path. */
  signal?: AbortSignal;
  /** A10: called AT MOST ONCE per `retrieveHybridMatches()` call, only
   * when the semantic ranker fails for a reason OTHER than `signal`
   * aborting (a real provider rejection, a timeout, a malformed
   * response, ...) — the fix for a real reproduced gap: before this
   * existed, ANY semantic-side failure escaped uncaught and rejected this
   * function's ENTIRE promise, discarding the lexical ranking that had
   * (or would have) succeeded completely independently — an endpoint
   * outage with hybrid mode on used to block a previously-usable
   * lexical-only generation flow. Now, retrieval degrades to
   * LEXICAL-ONLY results and calls this with a human-readable reason
   * instead. A caller driving MULTIPLE per-operation retrieval calls for
   * ONE generation (rag/ragOperationRetrieval.ts's `retrieveForOperations()`)
   * is expected to de-duplicate its own reporting (e.g. a simple "already
   * reported this generation" flag) so a single outage is surfaced once,
   * not once per operation — see ragHybridConfig.ts's
   * `resolveHybridRetrieveMatches()` for where that binding actually
   * happens. */
  onSemanticFailure?: (message: string) => void;
}

/** Hybrid (lexical + semantic, RRF-fused) retrieval — same call shape as
 * `retrieveRagMatches()` plus one extra required `provider` argument, so a
 * caller (rag/ragHybridConfig.ts) can bind this into a
 * `ragOperationRetrieval.ts`-compatible retrieval function with minimal
 * glue. Returns matches whose `.score` is the FUSED RRF score (see
 * `RagMatch.score`'s own doc comment) — a real number, but never
 * comparable against a lexical-only match's score. */
export async function retrieveHybridMatches(
  index: RagIndex,
  provider: EmbeddingProvider,
  queryText: string,
  language: RagLanguage,
  automationMode: RagAutomationMode,
  options: HybridRetrievalOptions = {}
): Promise<RagMatch[]> {
  if (!queryText.trim()) {
    return [];
  }
  const topK = options.topK ?? 2;
  const rrfK = options.rrfK ?? DEFAULT_RRF_K;
  const gateConfig = options.gateConfig ?? DEFAULT_HYBRID_GATE;
  const staleFilePaths = options.staleFilePaths;
  const signal = options.signal;

  // A10: the semantic ranker's own promise NEVER rejects past this point —
  // a real (non-cancellation) failure is caught right here and converted
  // into an empty ranking plus one `onSemanticFailure` report, so
  // `Promise.all` below can't have the lexical ranker's OWN, completely
  // independent success discarded just because the network-dependent
  // semantic half had a bad day. A cancellation-caused failure (`signal`
  // is what actually aborted it) is the ONE case deliberately re-thrown —
  // work must STOP, never quietly fall back to a "lexical-only" retrieval
  // the caller is about to abandon anyway.
  const semanticPromise = rankSemanticCandidates(index.recipes, index.canonicalIds, provider, queryText, language, automationMode, staleFilePaths, signal).catch(
    (err): SemanticCandidate[] => {
      if (signal?.aborted) {
        throw err; // cancellation — propagate, never start a fallback
      }
      options.onSemanticFailure?.(err instanceof Error ? err.message : String(err));
      return [];
    }
  );

  const [lexicalMatches, semanticRanked] = await Promise.all([
    // A wide pool (every language-compatible recipe), NOT just the usual
    // small topK — fusion needs each ranker's FULL relative ordering, not
    // a pre-truncated one, or a recipe ranked (say) 5th lexically but 1st
    // semantically would never even be a candidate for fusion at all.
    // A08: staleFilePaths is applied HERE, inside the wide-pool ranking
    // itself, not against the final fused/gated result — see
    // retrieveRagMatches()'s and rankSemanticCandidates()'s own doc
    // comments on this same parameter for why.
    retrieveRagMatches(index, queryText, language, automationMode, index.store.size, DEFAULT_RELEVANCE_GATE, staleFilePaths),
    semanticPromise
  ]);

  if (lexicalMatches.length === 0 && semanticRanked.length === 0) {
    return [];
  }

  const matchById = new Map<string, RagMatch>(lexicalMatches.map((match) => [match.id, match]));
  // Keyed by CANONICAL id (same as the vector store's own Document metadata
  // and rankSemanticCandidates()'s output above) — never `recipe.frontmatter.id`
  // directly, or two recipes sharing one raw frontmatter id would collapse
  // onto a single map entry via last-write-wins, silently discarding one of
  // them and misattributing its body under a shared, still-colliding id
  // (A06).
  const recipeById = new Map(index.recipes.map((recipe, i) => [index.canonicalIds[i], recipe]));
  for (const candidate of semanticRanked) {
    if (matchById.has(candidate.id)) {
      continue; // already have a full RagMatch (body/imports/filePath) from the lexical pass
    }
    const recipe = recipeById.get(candidate.id);
    if (!recipe) {
      continue; // defensive — every semantic candidate id comes from index.recipes itself
    }
    matchById.set(candidate.id, {
      id: candidate.id, // the CANONICAL id — never recipe.frontmatter.id, which may collide (A06)
      title: recipe.frontmatter.title,
      body: recipe.body,
      imports: recipe.frontmatter.imports,
      score: candidate.score, // placeholder — overwritten with the fused score below for every returned match
      filePath: recipe.filePath
    });
  }

  const lists: RankedList[] = [
    { source: 'lexical', ids: lexicalMatches.map((match) => match.id) },
    { source: 'semantic', ids: semanticRanked.map((candidate) => candidate.id) }
  ];
  const fused = reciprocalRankFusion(lists, rrfK);

  const gateCandidates: GateCandidate[] = fused.flatMap((f) => {
    const match = matchById.get(f.id);
    const recipe = recipeById.get(f.id);
    if (!match || !recipe) {
      return [];
    }
    const modeMatches = recipe.frontmatter.automationMode.includes(automationMode);
    return [{ match: { ...match, score: f.fusedScore }, score: f.fusedScore, modeMatches }];
  });

  return applyRelevanceGate(gateCandidates, queryText, gateConfig)
    .filter((decision) => decision.accepted)
    .map((decision) => decision.match)
    .slice(0, topK);
}
