import type { RagLanguage } from './ragTypes';
import { formatRagPromptSection, RagMatch, RAG_MAX_RECIPE_BODY_CHARS, RAG_MAX_TOTAL_SECTION_CHARS } from './ragRetriever';
import type { RagOperation } from './ragOperationPlanner';
import type { OperationRagCandidate } from './ragOperationRetrieval';

/** A generous, deliberately UPPER-bound chars-per-token estimate (typical
 * English/code text averages meaningfully fewer chars per token than this)
 * used ONLY to size a char-based ceiling comfortably ABOVE what a real
 * token budget allows — F10's second half fix. `formatRagPromptSection()`'s
 * own fixed 1,500/4,000-char defaults were sized as a conservative,
 * small-context worst case; being FIXED regardless of the ACTUAL resolved
 * model's real context window, they silently capped a large-context
 * model's usable RAG budget far below what it could genuinely afford, even
 * once real per-request token counting (this module's whole reason for
 * existing) said there was room for more. This estimate deliberately errs
 * toward NEVER being the actual binding constraint — the real,
 * caller-supplied `countTokens` measurement below remains authoritative
 * either way; this only decides how much content `formatRagPromptSection()`
 * is even willing to consider before that real measurement happens. */
const GENEROUS_CHARS_PER_TOKEN_ESTIMATE = 6;

/**
 * Complete-contract packing against the ACTUAL resolved model's real token
 * budget (Phase 3) — layered ON TOP of, not replacing,
 * rag/ragRetriever.ts's `formatRagPromptSection()`: that function already
 * guarantees fence-safe per-recipe packing (never slicing through a
 * signature, import, or code fence) against a fixed CHARACTER cap; this
 * module adds (1) coverage-aware ordering — prefer a candidate that covers
 * an operation nothing else does yet over a redundant extra example for an
 * already-covered one — and (2) a REAL measured-token final check against
 * the model's own remaining budget, dropping whole lowest-priority
 * candidates (never slicing one) until what's left actually fits.
 *
 * `sendPrompt()`'s own `assertMessagesFitModel()` preflight
 * (llm/copilotClient.ts) remains the authoritative LAST guard right before
 * a request is actually sent — this module's own token counting is for
 * ALLOCATION decisions (how much RAG content to include), not a
 * replacement for that final admission check.
 */

export type OmissionReason =
  /** Reserved for Phase 4 (relevance/abstention calibration) — a
   * candidate that scored below a future calibrated relevance gate. Never
   * emitted today: `retrieveRagMatches()`'s only filter is `score > 0`,
   * so nothing reaching this module has been judged "irrelevant" by any
   * existing mechanism. */
  | 'irrelevant'
  /** Reserved — language incompatibility is already a HARD filter inside
   * `retrieveRagMatches()` itself, so an incompatible recipe never becomes
   * a candidate in the first place; there is nothing for this module to
   * label as such. */
  | 'incompatible'
  /** A candidate whose own recipe file is `stale` or `missing` per Phase
   * 5's active freshness check (rag/ragFreshnessChecker.ts,
   * rag/ragFreshnessService.ts) — see `PackOptions.staleFilePaths` below.
   * Hard-excluded from packing entirely, regardless of budget or coverage
   * — a recipe known to no longer reflect its real source is never a
   * candidate worth spending token budget on. An `unverifiable` or
   * `error`-state recipe (freshness genuinely COULDN'T be determined) is
   * deliberately NEVER excluded this way — "can't tell" is not the same
   * claim as "confirmed stale," and a legacy/hand-authored recipe with no
   * provenance to check must stay fully eligible (F08's own "do not
   * blindly hard-filter unknown metadata, especially for legacy recipes"
   * requirement). */
  | 'stale'
  /** This candidate would have added genuinely new operation coverage but
   * didn't fit within the remaining token budget. */
  | 'budget'
  /** This candidate's own operation coverage is ENTIRELY already satisfied
   * by higher-priority included candidates — omitting it costs nothing in
   * coverage, whether or not it would also have fit. */
  | 'duplicate';

export interface PackingDiagnostics {
  /** Every candidate ID retrieveForOperations() found, before any
   * packing decision. */
  retrievedIds: string[];
  /** The subset that actually made it into `section`. */
  includedIds: string[];
  omitted: { id: string; reason: OmissionReason }[];
  /** Whether each requested operation ended up with at least one included
   * candidate covering it — the direct, honest measure of "coverage loss"
   * when the budget was too tight to include everything. */
  operationCoverage: { operationId: string; covered: boolean }[];
  /** The REAL measured token count of `section` (via the caller-supplied
   * `countTokens`) — `undefined` when counting itself was unavailable (see
   * `tokensUnmeasured`), never a character-based estimate presented as a
   * real count. */
  countedTokens?: number;
  /** True when `countTokens` itself failed/was unavailable — packing still
   * produced a best-effort, char-capped `section` in that case
   * (formatRagPromptSection()'s own safety net), but callers must not
   * describe the result as "token-safe" when this is true. */
  tokensUnmeasured: boolean;
}

export interface PackedRagResult {
  section: string;
  includedMatches: RagMatch[];
  diagnostics: PackingDiagnostics;
}

/** Returns `undefined` (not a thrown error) when a token count genuinely
 * can't be determined — the same "unmeasured is not the same claim as
 * measured-and-safe" convention as llm/tokenBudget.ts's own
 * `decideTokenBudget()`. */
export type TokenCounter = (text: string) => Promise<number | undefined>;

export interface PackOptions {
  /** The ACTUAL resolved model's real context window — never a guessed or
   * hardcoded constant. */
  maxInputTokens: number;
  /** Same safety-margin CONCEPT as llm/tokenBudget.ts's
   * `PROMPT_TOKEN_SAFETY_MARGIN` — passed in explicitly rather than
   * imported, so this module has no `vscode`-adjacent dependency chain and
   * a caller can reuse the exact same constant for both this and the
   * final `assertMessagesFitModel()` guard. */
  safetyMargin: number;
  /** Tokens already consumed by everything else in the request (built-in
   * instructions, custom instruction files, the RAG section aside) —
   * measured by the caller via the SAME `countTokens` before calling this. */
  mandatoryTokens: number;
  countTokens: TokenCounter;
  /** `RagMatch.filePath` values (see `OperationRagCandidate.match`) this
   * caller has determined are `stale`/`missing` per Phase 5's active
   * freshness check — every matching candidate is hard-excluded and
   * reported with `OmissionReason` `'stale'` (F08 fix: freshness state now
   * actually affects what gets packed, not just what a manual check
   * reports). Optional; omitting it (or passing an empty set) excludes
   * nothing, today's exact prior behavior. This module has no opinion on
   * HOW that determination was made — see rag/ragHybridConfig.ts-style
   * callers (objectSpyPanel.ts, agenticModeController.ts) for where the
   * actual freshness report is fetched and turned into this set. */
  staleFilePaths?: ReadonlySet<string>;
}

/** Whether `a` should be tried BEFORE `b` when greedily building the
 * packing order: covering at least one NOT-YET-covered operation always
 * wins over one that doesn't (closing a coverage gap beats a redundant
 * extra example for something already covered); among two candidates that
 * are equivalent on that axis, the higher `bestScore` wins; ties are
 * broken by capability ID for a fully deterministic order regardless of
 * input array order or object identity. */
function isHigherPriority(a: OperationRagCandidate, b: OperationRagCandidate, covered: ReadonlySet<string>): boolean {
  const aCoversNew = a.coveredOperationIds.some((id) => !covered.has(id));
  const bCoversNew = b.coveredOperationIds.some((id) => !covered.has(id));
  if (aCoversNew !== bCoversNew) {
    return aCoversNew;
  }
  if (a.bestScore !== b.bestScore) {
    return a.bestScore > b.bestScore;
  }
  return a.match.id < b.match.id;
}

/** Greedily orders candidates: at each step, picks whichever remaining
 * candidate is highest-priority given what's covered SO FAR (not a static
 * one-time sort — covering operation X changes what counts as "new"
 * coverage for every later pick), so the front of the returned array is
 * exactly the set that maximizes early operation coverage. */
function orderCandidatesByCoverage(candidates: OperationRagCandidate[]): OperationRagCandidate[] {
  const remaining = [...candidates];
  const covered = new Set<string>();
  const ordered: OperationRagCandidate[] = [];
  while (remaining.length > 0) {
    let bestIndex = 0;
    for (let i = 1; i < remaining.length; i++) {
      if (isHigherPriority(remaining[i], remaining[bestIndex], covered)) {
        bestIndex = i;
      }
    }
    const [chosen] = remaining.splice(bestIndex, 1);
    ordered.push(chosen);
    for (const opId of chosen.coveredOperationIds) {
      covered.add(opId);
    }
  }
  return ordered;
}

/**
 * Packs `candidates` (already retrieved, deduplicated, and annotated with
 * which operations each one covers — see `retrieveForOperations()`) into a
 * complete, fence-safe, real-token-budget-respecting RAG prompt section.
 *
 * Algorithm: (0) hard-exclude any candidate in `options.staleFilePaths`
 * (F08) before anything else; (1) order the remaining candidates
 * coverage-first; (2) try including ALL of them via
 * `formatRagPromptSection()` (already fence-safe/char-capped) — the common
 * case, everything fits; (3) if it doesn't, build the packed set up
 * INCREMENTALLY instead, trying each candidate in priority order against
 * the running total and SKIPPING (never slicing, and never aborting the
 * whole attempt for) any single one that would push it over budget — F11
 * fix: the previous approach started from everything and dropped from the
 * TAIL (lowest priority) until it fit, which could return NOTHING the
 * moment the single HIGHEST-priority candidate alone already exceeded the
 * budget, even though a smaller, lower-priority candidate further down the
 * list would have fit comfortably on its own; skipping one candidate and
 * continuing to try the rest never has that failure mode.
 */
export async function packOperationCandidates(
  candidates: OperationRagCandidate[],
  operations: RagOperation[],
  language: RagLanguage,
  options: PackOptions
): Promise<PackedRagResult> {
  const staleFilePaths = options.staleFilePaths ?? new Set<string>();
  const retrievedIds = candidates.map((c) => c.match.id);
  const budget = Math.floor(options.maxInputTokens * options.safetyMargin) - options.mandatoryTokens;

  const buildDiagnostics = (
    includedMatches: RagMatch[],
    countedTokens: number | undefined,
    tokensUnmeasured: boolean
  ): PackingDiagnostics => {
    const includedIds = new Set(includedMatches.map((m) => m.id));
    const coveredByIncluded = new Set<string>();
    for (const candidate of candidates) {
      if (includedIds.has(candidate.match.id)) {
        for (const opId of candidate.coveredOperationIds) {
          coveredByIncluded.add(opId);
        }
      }
    }
    const omitted = candidates
      .filter((c) => !includedIds.has(c.match.id))
      .map((c) => ({
        id: c.match.id,
        reason: (staleFilePaths.has(c.match.filePath)
          ? 'stale'
          : c.coveredOperationIds.every((opId) => coveredByIncluded.has(opId))
            ? 'duplicate'
            : 'budget') as OmissionReason
      }));
    const operationCoverage = operations.map((op) => ({ operationId: op.operationId, covered: coveredByIncluded.has(op.operationId) }));
    return { retrievedIds, includedIds: Array.from(includedIds), omitted, operationCoverage, countedTokens, tokensUnmeasured };
  };

  if (budget <= 0) {
    // Mandatory context ALONE already exceeds the budget — nothing to
    // pack. sendPrompt()'s own assertMessagesFitModel() preflight is what
    // actually surfaces this actionably (PromptTooLargeError) once a real
    // send is attempted; this is not a duplicate error path, just an
    // honest "no RAG content fits" report.
    return { section: '', includedMatches: [], diagnostics: buildDiagnostics([], 0, false) };
  }

  const eligible = candidates.filter((c) => !staleFilePaths.has(c.match.filePath));
  const ordered = orderCandidatesByCoverage(eligible);

  // F10's second half: size formatRagPromptSection()'s own char ceilings
  // to comfortably exceed what THIS request's real token budget allows,
  // using a generous chars-per-token estimate — never smaller than the
  // original fixed defaults (so a small/default-sized budget behaves
  // exactly as before), but scaling UP for a genuinely large-context
  // model/budget so it isn't held to an unrelated fixed constant. The
  // real `countTokens` measurement below remains the authoritative check
  // either way — this only affects how much content formatRagPromptSection
  // is willing to consider before that real measurement happens.
  const charCapOptions = {
    maxTotalSectionChars: Math.max(RAG_MAX_TOTAL_SECTION_CHARS, budget * GENEROUS_CHARS_PER_TOKEN_ESTIMATE),
    maxRecipeBodyChars: Math.max(RAG_MAX_RECIPE_BODY_CHARS, Math.floor((budget * GENEROUS_CHARS_PER_TOKEN_ESTIMATE) / 2))
  };

  // Fast path: try everything (eligible) at once — the common case where
  // it all fits, and also the "can't measure at all" fallback, exactly
  // matching prior behavior for both.
  const everythingBuilt = formatRagPromptSection(
    ordered.map((c) => c.match),
    language,
    charCapOptions
  );
  if (everythingBuilt.section) {
    const measured = await options.countTokens(everythingBuilt.section);
    if (measured === undefined) {
      return { section: everythingBuilt.section, includedMatches: everythingBuilt.includedMatches, diagnostics: buildDiagnostics(everythingBuilt.includedMatches, undefined, true) };
    }
    if (measured <= budget) {
      return { section: everythingBuilt.section, includedMatches: everythingBuilt.includedMatches, diagnostics: buildDiagnostics(everythingBuilt.includedMatches, measured, false) };
    }
  }

  // Doesn't all fit together — build up incrementally instead (F11 fix).
  let acceptedMatches: RagMatch[] = [];
  let acceptedSection = '';
  let acceptedTokens = 0;
  for (const candidate of ordered) {
    const trial = formatRagPromptSection([...acceptedMatches, candidate.match], language, charCapOptions);
    if (!trial.section || !trial.includedMatches.some((m) => m.id === candidate.match.id)) {
      continue; // doesn't fit even formatRagPromptSection's own char caps alongside what's accepted so far — skip, try the next candidate
    }
    const measured = await options.countTokens(trial.section);
    if (measured === undefined) {
      // Can't measure mid-way through — accept this char-capped trial as
      // the best-effort result and stop, per the same explicit
      // "unmeasured is never silently token-safe" policy as the fast path
      // above.
      return { section: trial.section, includedMatches: trial.includedMatches, diagnostics: buildDiagnostics(trial.includedMatches, undefined, true) };
    }
    if (measured <= budget) {
      acceptedMatches = trial.includedMatches;
      acceptedSection = trial.section;
      acceptedTokens = measured;
    }
    // else: adding this one would exceed budget — skip it, keep trying the rest (never abort entirely).
  }

  return { section: acceptedSection, includedMatches: acceptedMatches, diagnostics: buildDiagnostics(acceptedMatches, acceptedMatches.length > 0 ? acceptedTokens : 0, false) };
}
