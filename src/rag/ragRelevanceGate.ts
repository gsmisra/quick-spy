import type { RagMatch } from './ragRetriever';

/**
 * Configurable relevance/abstention GATE (Phase 4) — deliberately
 * SEPARATE from ranking (rag/ragRetriever.ts's own TF-IDF scoring +
 * automationMode soft-preference reranking, both unchanged by this
 * module). Ranking decides ORDER; this decides WHETHER a ranked candidate
 * is accepted at all — today's entire "acceptance" bar was just
 * `score > 0`, which accepts almost anything (see BASELINE.md's own
 * recorded finding: a 66.7% no-match false-positive rate on the synthetic
 * benchmark, purely from residual stopword overlap). This module makes
 * that bar configurable and testable instead of an implicit accident of
 * the scoring math.
 *
 * `DEFAULT_RELEVANCE_GATE` reproduces today's exact behavior byte-for-byte
 * (any positive score is accepted) — a CONSERVATIVE, backward-compatible
 * production default kept in place until real (non-synthetic) evidence
 * justifies changing it (see rag/benchmark/ragCalibrationRunner.ts's own
 * doc comment on why a synthetic-only calibration result is never promoted
 * to this default automatically).
 *
 * Deliberately pure, zero `vscode` import, directly unit tested.
 */

export interface RelevanceGateConfig {
  /** Minimum acceptable score (the SAME final score `retrieveRagMatches()`
   * already computes — TF-IDF cosine similarity, automationMode penalty
   * already applied). Named "Lexical" deliberately: this is a TF-IDF-scale
   * threshold specifically, NEVER to be reused verbatim for a future
   * hybrid/fused score (Phase 6's reciprocal-rank-fusion scores live on an
   * entirely different scale — see that phase's own calibration, not this
   * one, when it exists). Default `0` — today's exact "any positive score"
   * behavior. */
  minLexicalScore: number;
  /** Require the query text to contain an explicit lexical token derived
   * from the candidate's own id (see `hasSymbolEvidence()`) — a cheap,
   * deterministic proxy for "the query is actually about this specific
   * thing," distinct from a generic content-overlap score. Default
   * `false` — today's behavior never checks this. */
  requireSymbolEvidence: boolean;
  /** Require automationMode to ACTUALLY match (reverting
   * ragRetriever.ts's soft mismatch-PENALTY back to a hard requirement for
   * acceptance purposes specifically) rather than merely scoring lower.
   * This is a STATISTICAL/relevance calibration knob, deliberately kept
   * separate from structural compatibility facts like a recipe's
   * `language` (still, and always, a hard filter inside
   * `retrieveRagMatches()` itself — irrelevant here) or genuinely
   * UNKNOWN/missing metadata on a legacy recipe (this schema requires
   * `automationMode` on every valid recipe, so "unknown" doesn't arise in
   * practice — but if it ever does via some future relaxed/legacy path,
   * that must be treated as "can't judge," never silently treated as
   * "failed," a distinct concern from this toggle). Default `false` —
   * today's soft-preference behavior (see ragRetriever.ts's own doc
   * comment on why that fix exists at all). */
  requireModeCompatibility: boolean;
}

export const DEFAULT_RELEVANCE_GATE: RelevanceGateConfig = {
  minLexicalScore: 0,
  requireSymbolEvidence: false,
  requireModeCompatibility: false
};

/** Minimum token length counted as real "symbol evidence" — short common
 * words (e.g. "a", "to", "and", "for" — any of which can appear as a
 * fragment of a hyphenated id, e.g. "postgres-query-AND-validate") carry
 * too little signal to count as evidence of anything specific; a query
 * mentioning "and" incidentally shouldn't count as "evidence" for a recipe
 * whose id happens to contain that word as a connector. 4 chars excludes
 * essentially every common English connector/article while still
 * capturing real short technical terms (e.g. "auth", "user", "sync"). */
const MIN_SYMBOL_TOKEN_LENGTH = 4;

/** Whether `queryText` contains an explicit lexical token drawn from
 * `matchId` itself (e.g. "postgres-query-and-validate" contributes
 * "postgres", "query", "and" (too short, skipped), "validate") — a
 * DETERMINISTIC, always-available proxy for "the query is actually about
 * this specific thing" that needs no extra data plumbing beyond the id
 * every recipe already has. Matched case-insensitively as a plain
 * substring — a real, if imperfect, signal; it can both under-match (a
 * query using a synonym never mentioned in the id) and over-match (a short
 * token appearing coincidentally) — that imprecision is exactly why this
 * is an OPT-IN gate parameter to calibrate, not a universal hard filter. */
export function hasSymbolEvidence(queryText: string, matchId: string): boolean {
  const queryLower = queryText.toLowerCase();
  const idTokens = matchId
    .toLowerCase()
    .split(/[-_]+/)
    .filter((token) => token.length >= MIN_SYMBOL_TOKEN_LENGTH);
  return idTokens.some((token) => queryLower.includes(token));
}

/** One ranked candidate, with the extra facts (beyond what `RagMatch`
 * itself carries) the gate needs to decide acceptance — kept as a
 * SEPARATE input type from `RagMatch` rather than extending that public
 * type, so `modeMatches` (an internal ranking detail) never leaks into
 * `RagMatch`'s own public shape used throughout the rest of the RAG
 * pipeline. */
export interface GateCandidate {
  match: RagMatch;
  /** The final score exactly as ranking computed it (TF-IDF cosine
   * similarity, automationMode penalty already applied if mismatched) —
   * kept as its own field for gate-logic clarity even though it's
   * currently identical to `match.score`. */
  score: number;
  /** Whether automationMode ACTUALLY matched (before any penalty) —
   * distinct from `score` already reflecting a penalized value when it
   * didn't. */
  modeMatches: boolean;
}

export interface GateDecision {
  match: RagMatch;
  accepted: boolean;
  /** Empty when accepted. One entry per FAILED check when rejected —
   * explicit provenance for why, never a bare boolean; a diagnostics
   * consumer (or a human reviewing a calibration run) can always see
   * exactly which configured rule(s) a candidate failed. */
  reasons: string[];
}

/** Applies `config` to every candidate independently — pure decision
 * logic, no sorting/truncation (that remains ranking's job in
 * ragRetriever.ts). With `DEFAULT_RELEVANCE_GATE`, every candidate with a
 * positive score is accepted with zero reasons recorded — byte-for-byte
 * today's existing behavior. */
export function applyRelevanceGate(candidates: GateCandidate[], queryText: string, config: RelevanceGateConfig): GateDecision[] {
  return candidates.map((candidate) => {
    const reasons: string[] = [];
    if (candidate.score <= 0) {
      reasons.push(`score ${candidate.score.toFixed(4)} is not positive`);
    } else if (candidate.score < config.minLexicalScore) {
      reasons.push(`score ${candidate.score.toFixed(4)} is below the configured minimum lexical score ${config.minLexicalScore}`);
    }
    if (config.requireSymbolEvidence && !hasSymbolEvidence(queryText, candidate.match.id)) {
      reasons.push(`no explicit symbol evidence found for "${candidate.match.id}" in the query text`);
    }
    if (config.requireModeCompatibility && !candidate.modeMatches) {
      reasons.push('automationMode does not match, and this gate configuration requires mode compatibility');
    }
    return { match: candidate.match, accepted: reasons.length === 0, reasons };
  });
}
