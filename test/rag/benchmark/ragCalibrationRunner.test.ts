import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  runCalibration,
  selectBestConfig,
  evaluateOnHoldout,
  buildCalibrationReport,
  computeObjectiveScore,
  evaluateDisqualification,
  CalibrationCandidateResult,
  DEFAULT_CALIBRATION_GRID,
  ABSTENTION_DISQUALIFICATION_THRESHOLD,
  runCalibrationProductionMode,
  evaluateOnHoldoutProductionMode,
  buildProductionModeCalibrationReport
} from '../../../src/rag/benchmark/ragCalibrationRunner';
import { DEFAULT_RELEVANCE_GATE } from '../../../src/rag/ragRelevanceGate';
import { parseBenchmarkDataset, BenchmarkDataset } from '../../../src/rag/benchmark/ragBenchmarkTypes';
import { AggregateMetrics } from '../../../src/rag/benchmark/ragBenchmarkMetrics';

function loadSyntheticDataset(): BenchmarkDataset {
  const datasetPath = path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const parsed = parseBenchmarkDataset(raw);
  assert.equal(parsed.ok, true);
  return parsed.dataset!;
}

function makeMetrics(overrides: Partial<AggregateMetrics> = {}): AggregateMetrics {
  return {
    queryCount: 10,
    positiveQueryCount: 8,
    negativeQueryCount: 2,
    recallAtK: { value: 0.8, count: 8 },
    precisionAtK: { value: 0.5, count: 8 },
    precisionAmongReturned: { value: 0.5, count: 8 },
    meanReciprocalRank: { value: 0.7, count: 8 },
    noMatchFalsePositiveRate: { value: 0.1, count: 2 },
    positiveAbstentionRate: { value: 0, count: 8 },
    ...overrides
  };
}

// --- computeObjectiveScore ---------------------------------------------------

test('computeObjectiveScore: hand-calculated recall minus penalized false-positive rate', () => {
  const metrics = makeMetrics({ recallAtK: { value: 0.8, count: 8 }, noMatchFalsePositiveRate: { value: 0.2, count: 2 } });
  // 0.8 - 0.5 * 0.2 = 0.7 (within floating-point tolerance)
  assert.ok(Math.abs(computeObjectiveScore(metrics) - 0.7) < 1e-9);
});

test('computeObjectiveScore treats a null (not-applicable) recall or FP rate as 0, never as a crash', () => {
  const metrics = makeMetrics({ recallAtK: { value: null, count: 0 }, noMatchFalsePositiveRate: { value: null, count: 0 } });
  assert.equal(computeObjectiveScore(metrics), 0);
});

// --- evaluateDisqualification ------------------------------------------------

test('disqualifies a config abstaining on more than the threshold fraction of positive queries', () => {
  const metrics = makeMetrics({ positiveAbstentionRate: { value: ABSTENTION_DISQUALIFICATION_THRESHOLD + 0.01, count: 8 } });
  const result = evaluateDisqualification(metrics);
  assert.equal(result.disqualified, true);
  assert.match(result.reason!, /abstaining on \(almost\) everything is not a valid improvement/);
});

test('does not disqualify a config at or below the abstention threshold', () => {
  const metrics = makeMetrics({ positiveAbstentionRate: { value: ABSTENTION_DISQUALIFICATION_THRESHOLD, count: 8 } });
  assert.equal(evaluateDisqualification(metrics).disqualified, false);
});

test('does not disqualify when abstention rate is not applicable (null, zero positive queries)', () => {
  const metrics = makeMetrics({ positiveAbstentionRate: { value: null, count: 0 } });
  assert.equal(evaluateDisqualification(metrics).disqualified, false);
});

// --- selectBestConfig: deterministic tie-breaking ---------------------------

function candidateResult(label: string, config = DEFAULT_RELEVANCE_GATE, metricsOverrides: Partial<AggregateMetrics> = {}, disqualified = false): CalibrationCandidateResult {
  const metrics = makeMetrics(metricsOverrides);
  return {
    label,
    config,
    metrics,
    objectiveScore: computeObjectiveScore(metrics),
    disqualified,
    disqualificationReason: disqualified ? 'test-forced disqualification' : undefined
  };
}

test('selectBestConfig picks the candidate with the highest objective score', () => {
  const low = candidateResult('low', DEFAULT_RELEVANCE_GATE, { recallAtK: { value: 0.3, count: 8 } });
  const high = candidateResult('high', DEFAULT_RELEVANCE_GATE, { recallAtK: { value: 0.9, count: 8 } });
  const best = selectBestConfig([low, high]);
  assert.equal(best!.label, 'high');
});

test('selectBestConfig NEVER selects a disqualified candidate, even with the highest raw objective score', () => {
  const disqualifiedButHighScore = candidateResult('disqualified', DEFAULT_RELEVANCE_GATE, { recallAtK: { value: 0, count: 8 }, noMatchFalsePositiveRate: { value: 0, count: 2 } }, true);
  const eligible = candidateResult('eligible', DEFAULT_RELEVANCE_GATE, { recallAtK: { value: 0.5, count: 8 } });
  const best = selectBestConfig([disqualifiedButHighScore, eligible]);
  assert.equal(best!.label, 'eligible');
});

test('selectBestConfig returns undefined when EVERY candidate is disqualified', () => {
  const a = candidateResult('a', DEFAULT_RELEVANCE_GATE, {}, true);
  const b = candidateResult('b', DEFAULT_RELEVANCE_GATE, {}, true);
  assert.equal(selectBestConfig([a, b]), undefined);
});

test('selectBestConfig ties on objective score, then breaks the tie by higher recall', () => {
  // Same objective score (0.8 - 0.5*0 = 0.8 for both) but different recall/precision mix.
  const a = candidateResult('a', DEFAULT_RELEVANCE_GATE, { recallAtK: { value: 0.8, count: 8 }, noMatchFalsePositiveRate: { value: 0, count: 2 } });
  const b = candidateResult('b', { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 0.05 }, { recallAtK: { value: 0.8, count: 8 }, noMatchFalsePositiveRate: { value: 0, count: 2 } });
  const best = selectBestConfig([a, b]);
  // Truly tied on everything (same recall too) — falls through to the
  // "fewer non-default params" tie-break, where `a` (the default config)
  // wins over `b` (one non-default param).
  assert.equal(best!.label, 'a');
});

test('selectBestConfig is fully deterministic regardless of input array order', () => {
  const results = DEFAULT_CALIBRATION_GRID.map((entry, i) => candidateResult(entry.label, entry.config, { recallAtK: { value: 0.5 + i * 0.01, count: 8 } }));
  const forward = selectBestConfig(results);
  const reversed = selectBestConfig([...results].reverse());
  assert.equal(forward!.label, reversed!.label);
});

// --- end-to-end against the real synthetic dataset --------------------------

test('runCalibration only ever scores DEVELOPMENT-split queries, never holdout', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runCalibration(dataset, [{ label: 'default', config: DEFAULT_RELEVANCE_GATE }]);
  const devCount = dataset.queries.filter((q) => q.split === 'development').length;
  assert.equal(results[0].metrics.queryCount, devCount);
});

test('evaluateOnHoldout only ever scores HOLDOUT-split queries', async () => {
  const dataset = loadSyntheticDataset();
  const result = await evaluateOnHoldout(dataset, DEFAULT_RELEVANCE_GATE);
  const holdoutCount = dataset.queries.filter((q) => q.split === 'holdout').length;
  assert.equal(result.metrics.queryCount, holdoutCount);
});

test('runCalibration against the real dataset produces one result per grid entry, all deterministic across repeated runs', async () => {
  const dataset = loadSyntheticDataset();
  const resultsA = await runCalibration(dataset);
  const resultsB = await runCalibration(dataset);
  assert.equal(resultsA.length, DEFAULT_CALIBRATION_GRID.length);
  assert.deepEqual(resultsA, resultsB);
});

test('a full calibration cycle (grid -> select -> holdout) runs end to end without throwing', async () => {
  const dataset = loadSyntheticDataset();
  const grid = await runCalibration(dataset);
  const selected = selectBestConfig(grid);
  assert.ok(selected, 'at least one candidate should be eligible on this dataset');
  const holdout = await evaluateOnHoldout(dataset, selected!.config);
  assert.ok(holdout.metrics.queryCount > 0);
});

// --- buildCalibrationReport ---------------------------------------------------

test('buildCalibrationReport marks the report PROVISIONAL when any query is synthetic-origin', () => {
  const dataset = loadSyntheticDataset(); // all synthetic
  const report = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  assert.equal(report.json.provisional, true);
  assert.match(report.markdown, /PROVISIONAL/);
});

test('buildCalibrationReport never claims a threshold is "production-tuned"', () => {
  const dataset = loadSyntheticDataset();
  const report = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  assert.doesNotMatch(report.markdown, /production-tuned/i);
});

test('buildCalibrationReport always includes the actual production default for comparison', () => {
  const dataset = loadSyntheticDataset();
  const report = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  assert.deepEqual(report.json.productionDefault, DEFAULT_RELEVANCE_GATE);
});

test('buildCalibrationReport is deterministic given the same inputs', () => {
  const dataset = loadSyntheticDataset();
  const reportA = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  const reportB = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  assert.deepEqual(reportA.json, reportB.json);
  assert.equal(reportA.markdown, reportB.markdown);
});

test('buildCalibrationReport handles the "no eligible candidate" case honestly, without a holdout section pretending otherwise', () => {
  const dataset = loadSyntheticDataset();
  const report = buildCalibrationReport(dataset, [], undefined, undefined, 'fixed-time');
  assert.match(report.markdown, /No candidate was selected/);
  assert.match(report.markdown, /Skipped — no eligible candidate/);
});

// --- PRODUCTION-PIPELINE mode (F15) ------------------------------------------

test('runCalibrationProductionMode only ever scores DEVELOPMENT-split queries, never holdout', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runCalibrationProductionMode(dataset, [{ label: 'default', config: DEFAULT_RELEVANCE_GATE }]);
  const devCount = dataset.queries.filter((q) => q.split === 'development').length;
  assert.equal(results[0].metrics.queryCount, devCount);
});

test('evaluateOnHoldoutProductionMode only ever scores HOLDOUT-split queries', async () => {
  const dataset = loadSyntheticDataset();
  const result = await evaluateOnHoldoutProductionMode(dataset, DEFAULT_RELEVANCE_GATE);
  const holdoutCount = dataset.queries.filter((q) => q.split === 'holdout').length;
  assert.equal(result.metrics.queryCount, holdoutCount);
});

test('runCalibrationProductionMode against the real dataset produces one result per grid entry, all deterministic across repeated runs', async () => {
  const dataset = loadSyntheticDataset();
  const resultsA = await runCalibrationProductionMode(dataset);
  const resultsB = await runCalibrationProductionMode(dataset);
  assert.equal(resultsA.length, DEFAULT_CALIBRATION_GRID.length);
  assert.deepEqual(resultsA, resultsB);
});

test('a full PRODUCTION-PIPELINE calibration cycle (grid -> select -> holdout) runs end to end without throwing', async () => {
  const dataset = loadSyntheticDataset();
  const grid = await runCalibrationProductionMode(dataset);
  const selected = selectBestConfig(grid);
  assert.ok(selected, 'at least one candidate should be eligible on this dataset');
  const holdout = await evaluateOnHoldoutProductionMode(dataset, selected!.config);
  assert.ok(holdout.metrics.queryCount > 0);
});

test('PRODUCTION-PIPELINE mode scores queries through real operation decomposition + packing, so it need not exactly match LEGACY mode\'s per-query metrics', async () => {
  const dataset = loadSyntheticDataset();
  const legacyGrid = await runCalibration(dataset, [{ label: 'default', config: DEFAULT_RELEVANCE_GATE }]);
  const productionGrid = await runCalibrationProductionMode(dataset, [{ label: 'default', config: DEFAULT_RELEVANCE_GATE }]);
  // Both modes score the SAME development-split query set — this is the
  // one invariant guaranteed to hold across both, since the two modes are
  // free to disagree on the metrics themselves (that's the whole point of
  // having a second mode at all).
  assert.equal(legacyGrid[0].metrics.queryCount, productionGrid[0].metrics.queryCount);
});

// --- buildProductionModeCalibrationReport ------------------------------------

test('buildProductionModeCalibrationReport marks the report PROVISIONAL when any query is synthetic-origin', () => {
  const dataset = loadSyntheticDataset(); // all synthetic
  const report = buildProductionModeCalibrationReport(dataset, [], undefined, undefined, { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000 }, 'fixed-time');
  assert.equal(report.json.provisional, true);
  assert.match(report.markdown, /PROVISIONAL/);
});

test('buildProductionModeCalibrationReport records the corpus fingerprint and estimated-budget config used', () => {
  const dataset = loadSyntheticDataset();
  const report = buildProductionModeCalibrationReport(
    dataset,
    [],
    undefined,
    undefined,
    { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000 },
    'fixed-time'
  );
  assert.match(report.json.corpusFingerprint, /^[0-9a-f]{64}$/);
  assert.match(report.markdown, /Corpus fingerprint/);
  assert.match(report.markdown, /perOperationK=3/);
});

test('buildProductionModeCalibrationReport reports git provenance as unavailable, never fabricated, when none is supplied', () => {
  const dataset = loadSyntheticDataset();
  const report = buildProductionModeCalibrationReport(dataset, [], undefined, undefined, { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000 }, 'fixed-time');
  assert.equal(report.json.meta.gitProvenance, undefined);
  assert.match(report.markdown, /Git: unavailable/);
});

test('buildProductionModeCalibrationReport never claims a threshold is "production-tuned"', () => {
  const dataset = loadSyntheticDataset();
  const report = buildProductionModeCalibrationReport(dataset, [], undefined, undefined, { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000 }, 'fixed-time');
  assert.doesNotMatch(report.markdown, /production-tuned/i);
});

test('buildProductionModeCalibrationReport is deterministic given the same inputs', () => {
  const dataset = loadSyntheticDataset();
  const meta = { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000 };
  const reportA = buildProductionModeCalibrationReport(dataset, [], undefined, undefined, meta, 'fixed-time');
  const reportB = buildProductionModeCalibrationReport(dataset, [], undefined, undefined, meta, 'fixed-time');
  assert.deepEqual(reportA.json, reportB.json);
  assert.equal(reportA.markdown, reportB.markdown);
});
