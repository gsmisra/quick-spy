import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  toRequirementUnits,
  recallAtK,
  precisionAtK,
  reciprocalRank,
  scoreQuery,
  aggregateBenchmarkMetrics,
  PerQueryMetrics
} from '../../../src/rag/benchmark/ragBenchmarkMetrics';

// --- toRequirementUnits -----------------------------------------------------

test('toRequirementUnits: standalone IDs each become their own single-member unit', () => {
  assert.deepEqual(toRequirementUnits(['a', 'b']), [['a'], ['b']]);
});

test('toRequirementUnits: an alternative group becomes ONE multi-member unit', () => {
  assert.deepEqual(toRequirementUnits([], [['a', 'b']]), [['a', 'b']]);
});

test('toRequirementUnits: an ID inside a group is not ALSO counted as its own standalone requirement', () => {
  const units = toRequirementUnits(['a', 'c'], [['a', 'b']]);
  // "a" only appears inside the group unit, not as an extra ['a'] unit.
  assert.deepEqual(units, [['c'], ['a', 'b']]);
});

test('toRequirementUnits: empty relevantIds and no groups is a genuine no-match case', () => {
  assert.deepEqual(toRequirementUnits([], []), []);
  assert.deepEqual(toRequirementUnits([]), []);
});

// --- recallAtK — hand-calculated -------------------------------------------

test('recallAtK: hand-calculated — 2 of 3 relevant IDs found in top 3', () => {
  // relevant = [a, b, c]; returned = [x, a, b] -> a and b found, c missed.
  const units = toRequirementUnits(['a', 'b', 'c']);
  assert.equal(recallAtK(['x', 'a', 'b'], units, 3), 2 / 3);
});

test('recallAtK: a total MISS returns exactly 0', () => {
  const units = toRequirementUnits(['a']);
  assert.equal(recallAtK(['x', 'y', 'z'], units, 3), 0);
});

test('recallAtK: FEWER returned than k still only counts what fits within k', () => {
  const units = toRequirementUnits(['a', 'b']);
  assert.equal(recallAtK(['a'], units, 5), 1 / 2); // only 1 result returned at all, k=5 doesn't matter
});

test('recallAtK: DUPLICATE IDs in the returned list do not inflate recall', () => {
  const units = toRequirementUnits(['a', 'b']);
  assert.equal(recallAtK(['a', 'a', 'a'], units, 3), 1 / 2); // "a" found once, "b" never — still 0.5, not 3/2 or 1
});

test('recallAtK: a deliberate NO-MATCH query (empty requirement set) returns null, not 0 or 1', () => {
  assert.equal(recallAtK(['a', 'b'], [], 3), null);
  assert.equal(recallAtK([], [], 3), null);
});

test('recallAtK: an ALTERNATIVE-HELPER requirement is satisfied by EITHER member', () => {
  const units = toRequirementUnits([], [['a', 'b']]);
  assert.equal(recallAtK(['x', 'b'], units, 2), 1); // only "b" of the pair needed to satisfy the one requirement
  assert.equal(recallAtK(['x', 'y'], units, 2), 0); // neither alternative present
});

test('recallAtK: mixing standalone and alternative-group requirements', () => {
  const units = toRequirementUnits(['c'], [['a', 'b']]);
  // 2 requirement units total: ["c"], ["a","b"]. Only "a" found -> 1 of 2 satisfied.
  assert.equal(recallAtK(['a', 'x'], units, 2), 1 / 2);
});

// --- precisionAtK — hand-calculated -----------------------------------------

test('precisionAtK: hand-calculated — 2 relevant out of k=3 returned', () => {
  const units = toRequirementUnits(['a', 'b']);
  const result = precisionAtK(['a', 'x', 'b'], units, 3);
  assert.equal(result.precisionAtK, 2 / 3);
  assert.equal(result.returnedCount, 3);
});

test('precisionAtK: FEWER returned than k — precisionAmongReturned differs from precisionAtK', () => {
  const units = toRequirementUnits(['a']);
  // Only 1 result returned at all, even though k=5.
  const result = precisionAtK(['a'], units, 5);
  assert.equal(result.precisionAtK, 1 / 5); // diluted by the full k
  assert.equal(result.precisionAmongReturned, 1 / 1); // but perfect among what was actually returned
  assert.equal(result.returnedCount, 1);
});

test('precisionAtK: ZERO returned at all — precisionAmongReturned is null (not 0), precisionAtK is a real 0', () => {
  const units = toRequirementUnits(['a']);
  const result = precisionAtK([], units, 3);
  assert.equal(result.precisionAtK, 0);
  assert.equal(result.precisionAmongReturned, null);
  assert.equal(result.returnedCount, 0);
});

test('precisionAtK: k=0 makes precisionAtK null (division by zero avoided), not a crash', () => {
  const units = toRequirementUnits(['a']);
  const result = precisionAtK(['a', 'b'], units, 0);
  assert.equal(result.precisionAtK, null);
});

test('precisionAtK: DUPLICATE IDs in the returned list are de-duplicated before counting', () => {
  const units = toRequirementUnits(['a']);
  const result = precisionAtK(['a', 'a', 'x'], units, 3);
  // Deduped top-3 = [a, x] (2 unique entries) -> 1 relevant / k=3, and 1/2 among the 2 actually distinct returned.
  assert.equal(result.precisionAtK, 1 / 3);
  assert.equal(result.precisionAmongReturned, 1 / 2);
});

// --- reciprocalRank — hand-calculated ---------------------------------------

test('reciprocalRank: hand-calculated — first relevant hit at rank 3 gives 1/3', () => {
  const units = toRequirementUnits(['c']);
  assert.equal(reciprocalRank(['a', 'b', 'c', 'd'], units), 1 / 3);
});

test('reciprocalRank: a hit at rank 1 gives exactly 1', () => {
  const units = toRequirementUnits(['a']);
  assert.equal(reciprocalRank(['a', 'b'], units), 1);
});

test('reciprocalRank: a total miss gives exactly 0', () => {
  const units = toRequirementUnits(['z']);
  assert.equal(reciprocalRank(['a', 'b', 'c'], units), 0);
});

test('reciprocalRank: a no-match query (empty units) gives 0, distinct from recallAtK\'s null', () => {
  assert.equal(reciprocalRank(['a', 'b'], []), 0);
});

test('reciprocalRank: only the FIRST relevant hit counts, later ones are ignored', () => {
  const units = toRequirementUnits(['b', 'c']);
  assert.equal(reciprocalRank(['a', 'b', 'c'], units), 1 / 2); // "b" at rank 2 wins, "c" at rank 3 is irrelevant to the score
});

// --- scoreQuery + aggregateBenchmarkMetrics --------------------------------

test('scoreQuery: a NEGATIVE query that returns nothing is correctly NOT a false positive', () => {
  const result = scoreQuery('q1', [], [], undefined, 3);
  assert.equal(result.isPositive, false);
  assert.equal(result.isFalsePositive, false);
  assert.equal(result.isAbstention, null);
  assert.equal(result.recallAtK, null);
});

test('scoreQuery: a NEGATIVE query that returns anything at all IS a false positive', () => {
  const result = scoreQuery('q1', ['unexpected-match'], [], undefined, 3);
  assert.equal(result.isFalsePositive, true);
});

test('scoreQuery: a POSITIVE query that returns nothing is an abstention, not a false positive', () => {
  const result = scoreQuery('q1', [], ['a'], undefined, 3);
  assert.equal(result.isPositive, true);
  assert.equal(result.isAbstention, true);
  assert.equal(result.isFalsePositive, null);
});

test('aggregateBenchmarkMetrics: hand-calculated mixed positive/negative dataset', () => {
  const perQuery: PerQueryMetrics[] = [
    scoreQuery('pos-hit', ['a', 'x'], ['a'], undefined, 3), // recall 1, precision 1/3, RR 1
    scoreQuery('pos-miss', ['x', 'y'], ['a'], undefined, 3), // recall 0, precision 0, RR 0, abstention=false (something was returned, just wrong)
    scoreQuery('neg-clean', [], [], undefined, 3), // negative, no false positive
    scoreQuery('neg-fp', ['z'], [], undefined, 3) // negative, false positive
  ];
  const agg = aggregateBenchmarkMetrics(perQuery);
  assert.equal(agg.queryCount, 4);
  assert.equal(agg.positiveQueryCount, 2);
  assert.equal(agg.negativeQueryCount, 2);
  assert.equal(agg.recallAtK.value, (1 + 0) / 2);
  assert.equal(agg.meanReciprocalRank.value, (1 + 0) / 2);
  assert.equal(agg.noMatchFalsePositiveRate.value, 1 / 2); // 1 of 2 negative queries was a false positive
  assert.equal(agg.positiveAbstentionRate.value, 0); // neither positive query actually abstained (both returned something)
});

test('aggregateBenchmarkMetrics: an EMPTY SUBSET reports null with count 0, never a misleading 0 or 1', () => {
  const agg = aggregateBenchmarkMetrics([]);
  assert.equal(agg.queryCount, 0);
  assert.deepEqual(agg.recallAtK, { value: null, count: 0 });
  assert.deepEqual(agg.noMatchFalsePositiveRate, { value: null, count: 0 });
  assert.deepEqual(agg.positiveAbstentionRate, { value: null, count: 0 });
});

test('aggregateBenchmarkMetrics: all-negative dataset never reports a fabricated recall/precision/MRR value', () => {
  const perQuery = [scoreQuery('n1', [], [], undefined, 3), scoreQuery('n2', ['x'], [], undefined, 3)];
  const agg = aggregateBenchmarkMetrics(perQuery);
  assert.equal(agg.positiveQueryCount, 0);
  assert.deepEqual(agg.recallAtK, { value: null, count: 0 });
  assert.deepEqual(agg.positiveAbstentionRate, { value: null, count: 0 });
  assert.equal(agg.noMatchFalsePositiveRate.value, 1 / 2);
});

test('aggregateBenchmarkMetrics: ALTERNATIVE-HELPER queries score correctly in an aggregate run', () => {
  const perQuery = [scoreQuery('alt', ['b', 'x'], [], [['a', 'b']], 3)];
  const agg = aggregateBenchmarkMetrics(perQuery);
  assert.equal(agg.recallAtK.value, 1); // "b" satisfies the alternative group
});
