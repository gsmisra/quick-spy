/**
 * Reciprocal Rank Fusion (RRF) — combines two or more independently-ranked
 * ID lists (e.g. lexical TF-IDF, semantic embedding similarity) into ONE
 * fused ranking, using each item's RANK POSITION in each list rather than
 * the raw scores themselves. This is the standard, well-established way to
 * combine rankings from scoring functions on different, incomparable
 * scales (Cormack, Clarke & Buettcher, "Reciprocal Rank Fusion outperforms
 * Condorcet and individual Rank Learning Methods", SIGIR 2009) — exactly
 * the situation here: TF-IDF cosine similarity and a neural embedding's
 * cosine similarity are NOT on the same scale, and averaging or otherwise
 * combining them directly would be comparing apples to oranges. Using
 * RANKS instead of raw scores sidesteps that entirely.
 *
 * Formula, per item `d` present in one or more ranked lists:
 *   fusedScore(d) = Σ 1 / (k + rank_i(d))     over every list i containing d
 * where `rank_i(d)` is `d`'s 1-based position in list `i`, and `k` is a
 * constant (see `DEFAULT_RRF_K`) that dampens the influence of any single
 * very-high rank and controls how quickly a list's contribution decays
 * moving down its ranking. An item absent from a list contributes nothing
 * from that list (never a penalty) — a genuinely relevant recipe missed by
 * ONE ranker still gets full credit from the other.
 *
 * Pure, zero dependency — the fused score is a NEW, ranking-derived
 * quantity, not comparable in scale to either input ranking's own raw
 * scores; callers must never reuse a lexical-only threshold (e.g.
 * `ragRelevanceGate.ts`'s `DEFAULT_RELEVANCE_GATE.minLexicalScore`) against
 * a fused score — see rag/ragHybridRetriever.ts's own `DEFAULT_HYBRID_GATE`
 * for why it is a SEPARATE, independently-calibratable constant.
 */

/** The standard literature default (Cormack et al. 2009 evaluate k=60
 * empirically as a robust, rarely-needing-retuning choice across very
 * different retrieval tasks) — not a value tuned against THIS corpus, kept
 * as the conservative, well-established starting point rather than an
 * invented one. Larger `k` flattens the influence of rank differences
 * (rank 1 vs rank 2 matters less); smaller `k` sharpens it. */
export const DEFAULT_RRF_K = 60;

export interface RankedList {
  /** Human-readable label for diagnostics ("lexical", "semantic") — never
   * used in the fusion arithmetic itself. */
  source: string;
  /** IDs in rank order, best match first. A duplicate ID within ONE list
   * is treated as if it only appeared once, at its FIRST (best) position —
   * a ranker should never emit duplicates in practice, but this is
   * defensively handled rather than silently double-counting a repeat. */
  ids: string[];
}

export interface FusedResult {
  id: string;
  /** The RRF-combined score — see this module's own doc comment for the
   * formula. Always strictly positive for any id that appears in at least
   * one non-empty list, since every term `1/(k+rank)` is itself positive. */
  fusedScore: number;
  /** Which list(s) actually contributed to this id's score, and at what
   * rank in each — full provenance for diagnostics/traceability, never
   * just the final number. */
  contributions: { source: string; rank: number }[];
}

/** Fuses `lists` into one ranking via Reciprocal Rank Fusion, sorted by
 * `fusedScore` descending. Ties (including the degenerate case of zero
 * input lists, or every list being empty) are broken by `id` itself
 * (ascending, lexicographic) for a fully deterministic result regardless
 * of input list order — the same "no unexplained non-determinism in a
 * ranking decision" principle as ragOperationPacking.ts's own
 * `isHigherPriority()` and rag/benchmark/ragCalibrationRunner.ts's
 * `isBetterCandidate()`. */
export function reciprocalRankFusion(lists: RankedList[], k: number = DEFAULT_RRF_K): FusedResult[] {
  const scores = new Map<string, number>();
  const contributions = new Map<string, { source: string; rank: number }[]>();

  for (const list of lists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of list.ids) {
      if (seen.has(id)) {
        continue; // a ranker emitting a duplicate — keep only its first (best) rank
      }
      seen.add(id);
      rank += 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
      const existing = contributions.get(id) ?? [];
      existing.push({ source: list.source, rank });
      contributions.set(id, existing);
    }
  }

  return Array.from(scores.entries())
    .map(([id, fusedScore]) => ({
      id,
      fusedScore,
      // Sorted by source name — `contributions`' array ORDER would
      // otherwise depend on which input list happened to be processed
      // first, which is an accident of caller-supplied list order, not a
      // meaningful fact about the result. Sorting makes the full output
      // byte-for-byte deterministic regardless of input list order, not
      // just the final ranking.
      contributions: (contributions.get(id) ?? []).sort((a, b) => a.source.localeCompare(b.source))
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore || a.id.localeCompare(b.id));
}
