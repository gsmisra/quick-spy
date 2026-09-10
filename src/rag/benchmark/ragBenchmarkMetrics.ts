/**
 * Pure retrieval-quality metrics for the RAG benchmark harness (Phase 1) —
 * zero `vscode` import, zero dependency on the actual retrieval pipeline,
 * so these are directly unit-testable against hand-calculated fixtures
 * independent of whatever ragRetriever.ts happens to return on a given
 * day. ragBenchmarkRunner.ts is the only caller that feeds REAL retrieval
 * output into these.
 *
 * A "requirement unit" is the unit of relevance this whole module reasons
 * about: either a single required capability ID, or an "alternative
 * group" — a set of IDs where satisfying ANY ONE of them meets that one
 * requirement (two equally-valid helpers for the same need). A query
 * needing three DIFFERENT things has three requirement units; a query
 * needing "a database helper, either A or B" has one requirement unit
 * with two acceptable IDs. See `toRequirementUnits()`.
 */

/** One requirement: an array of 1+ capability IDs, satisfied if the
 * returned list contains ANY of them. A standalone required ID becomes a
 * single-element unit; an alternative group becomes a multi-element one. */
export type RequirementUnit = string[];

/** Splits a query's `relevantIds` (every standalone requirement) and
 * `alternativeGroups` (each group is its OWN requirement, met by any
 * member) into a flat list of requirement units — the shape every metric
 * below actually operates on. An ID that appears in `alternativeGroups`
 * is NOT also counted as its own standalone requirement, even if it also
 * appears in `relevantIds` (the group already represents that
 * requirement); this is deliberate de-duplication, not a bug — a capability
 * that satisfies an alternative-group requirement should count toward that
 * ONE requirement, not two. */
export function toRequirementUnits(relevantIds: string[], alternativeGroups: string[][] = []): RequirementUnit[] {
  const grouped = new Set(alternativeGroups.flat());
  const standalone: RequirementUnit[] = relevantIds.filter((id) => !grouped.has(id)).map((id) => [id]);
  return [...standalone, ...alternativeGroups];
}

/** De-duplicates `ids` by first occurrence — a re-ranked duplicate (the
 * same capability ID appearing twice in a returned list, which should
 * never happen from a correct pipeline but is defensively handled here so
 * a bug upstream doesn't silently inflate a metric) counts only once. */
function dedupeKeepFirst(ids: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
}

/** Recall@k = requirement units satisfied within the first `k` returned
 * IDs / total requirement units. Returns `null` (not a number, not zero)
 * when there are ZERO requirement units — a deliberate no-match query has
 * no "recall" to speak of; reporting 0 or 1 here would misleadingly
 * suggest a positive-query failure or success that never applied. Callers
 * must check for `null` explicitly rather than treating it as a numeric
 * miss (see `aggregateBenchmarkMetrics()`'s own handling). */
export function recallAtK(returnedIds: string[], units: RequirementUnit[], k: number): number | null {
  if (units.length === 0) {
    return null;
  }
  const topK = new Set(dedupeKeepFirst(returnedIds).slice(0, k));
  const satisfied = units.filter((unit) => unit.some((id) => topK.has(id))).length;
  return satisfied / units.length;
}

export interface PrecisionResult {
  /** Relevant unique IDs in the first `k` / `k` — `null` when `k` is 0. */
  precisionAtK: number | null;
  /** Relevant unique IDs in the first `k` / however many were ACTUALLY
   * returned (`min(k, returnedIds.length)`) — the metric the spec calls
   * out by name so abstention (returning fewer than `k`, including zero)
   * is visible as its own number rather than diluted by a fixed `k`
   * denominator. `null` when nothing was returned at all. */
  precisionAmongReturned: number | null;
  /** How many results were actually considered (`min(k, returnedIds.length)`
   * after de-duplication) — surfaced so a report can show "returned 1 of a
   * possible 5" directly. */
  returnedCount: number;
}

export function precisionAtK(returnedIds: string[], units: RequirementUnit[], k: number): PrecisionResult {
  const deduped = dedupeKeepFirst(returnedIds);
  const topK = deduped.slice(0, k);
  const relevantFlat = new Set(units.flat());
  const relevantInTopK = topK.filter((id) => relevantFlat.has(id)).length;
  return {
    precisionAtK: k > 0 ? relevantInTopK / k : null,
    precisionAmongReturned: topK.length > 0 ? relevantInTopK / topK.length : null,
    returnedCount: topK.length
  };
}

/** Mean Reciprocal Rank contribution for ONE query: `1 / rank` of the
 * FIRST returned ID that satisfies any requirement unit (rank is
 * one-based, over the FULL returned list — not capped at a particular
 * `k`, since MRR is conventionally about "how far did I have to look,"
 * not "did it fit in my display window"). `0` for a miss — the standard
 * MRR convention, distinct from `recallAtK()`'s `null` for "not
 * applicable": a miss on a query that DOES have requirements is a real,
 * countable failure (0), whereas a no-match query has no requirements to
 * miss in the first place (`null`). */
export function reciprocalRank(returnedIds: string[], units: RequirementUnit[]): number {
  if (units.length === 0) {
    return 0; // no requirements to rank against — callers should exclude no-match queries from an MRR average entirely, same as recallAtK's null
  }
  const relevantFlat = new Set(units.flat());
  const deduped = dedupeKeepFirst(returnedIds);
  for (let i = 0; i < deduped.length; i++) {
    if (relevantFlat.has(deduped[i])) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

export interface PerQueryMetrics {
  queryId: string;
  /** Whether this query had ANY requirement units — a "positive" query
   * (something should be found) vs. a deliberate "negative"/no-match one. */
  isPositive: boolean;
  recallAtK: number | null;
  precision: PrecisionResult;
  reciprocalRank: number;
  /** True when this is a negative query AND at least one result was
   * returned anyway — a false positive. `null` for a positive query,
   * where the concept doesn't apply. */
  isFalsePositive: boolean | null;
  /** True when this is a positive query AND zero results were returned —
   * an abstention on a query that should have found something. `null`
   * for a negative query. */
  isAbstention: boolean | null;
}

/** Scores ONE query's actual returned IDs against its labeled
 * requirements. `k` should match whatever the real pipeline's own display/
 * inclusion cutoff is (e.g. `topK` in rag/ragRetriever.ts) so the metric
 * reflects what a user would actually see, not an arbitrary larger
 * window. */
export function scoreQuery(
  queryId: string,
  returnedIds: string[],
  relevantIds: string[],
  alternativeGroups: string[][] | undefined,
  k: number
): PerQueryMetrics {
  const units = toRequirementUnits(relevantIds, alternativeGroups);
  const isPositive = units.length > 0;
  const deduped = dedupeKeepFirst(returnedIds);
  return {
    queryId,
    isPositive,
    recallAtK: recallAtK(returnedIds, units, k),
    precision: precisionAtK(returnedIds, units, k),
    reciprocalRank: reciprocalRank(returnedIds, units),
    isFalsePositive: isPositive ? null : deduped.length > 0,
    isAbstention: isPositive ? deduped.length === 0 : null
  };
}

/** `value`/`count` rather than a bare number — the explicit
 * zero-denominator convention the whole benchmark report follows: an
 * empty subset (e.g. zero Python queries in this run) reports
 * `{ value: null, count: 0 }`, never a misleading `0` or `1` that looks
 * like a real, measured result. */
export interface Rate {
  value: number | null;
  count: number;
}

function average(values: number[]): Rate {
  return values.length > 0 ? { value: values.reduce((a, b) => a + b, 0) / values.length, count: values.length } : { value: null, count: 0 };
}

function proportion(flags: boolean[]): Rate {
  return flags.length > 0 ? { value: flags.filter(Boolean).length / flags.length, count: flags.length } : { value: null, count: 0 };
}

export interface AggregateMetrics {
  queryCount: number;
  positiveQueryCount: number;
  negativeQueryCount: number;
  recallAtK: Rate;
  precisionAtK: Rate;
  precisionAmongReturned: Rate;
  meanReciprocalRank: Rate;
  noMatchFalsePositiveRate: Rate;
  positiveAbstentionRate: Rate;
}

/** Aggregates a list of `PerQueryMetrics` into macro averages — every
 * average is over the queries where that metric actually APPLIES (recall/
 * precision/MRR over positive queries only; false-positive rate over
 * negative queries only; abstention rate over positive queries only),
 * never silently including a `null`/`not-applicable` value as if it were
 * zero. Callers that want a Java/Python, UI/API, or dev/holdout split
 * should filter the `PerQueryMetrics[]` input themselves before calling
 * this — this function itself has no opinion on how the corpus is split,
 * only on how to average correctly once it's given a subset. */
export function aggregateBenchmarkMetrics(perQuery: PerQueryMetrics[]): AggregateMetrics {
  const positive = perQuery.filter((q) => q.isPositive);
  const negative = perQuery.filter((q) => !q.isPositive);
  return {
    queryCount: perQuery.length,
    positiveQueryCount: positive.length,
    negativeQueryCount: negative.length,
    recallAtK: average(positive.map((q) => q.recallAtK).filter((v): v is number => v !== null)),
    precisionAtK: average(positive.map((q) => q.precision.precisionAtK).filter((v): v is number => v !== null)),
    precisionAmongReturned: average(positive.map((q) => q.precision.precisionAmongReturned).filter((v): v is number => v !== null)),
    meanReciprocalRank: average(positive.map((q) => q.reciprocalRank)),
    noMatchFalsePositiveRate: proportion(negative.map((q) => q.isFalsePositive === true)),
    positiveAbstentionRate: proportion(positive.map((q) => q.isAbstention === true))
  };
}
