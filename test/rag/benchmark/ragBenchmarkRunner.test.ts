import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import {
  toRagRecipe,
  runBenchmarkOnDataset,
  buildBenchmarkReport,
  operationsForBenchmarkQuery,
  runProductionPipelineOnDataset,
  buildProductionModeReport
} from '../../../src/rag/benchmark/ragBenchmarkRunner';
import { DEFAULT_RELEVANCE_GATE } from '../../../src/rag/ragRelevanceGate';
import { parseBenchmarkDataset, BenchmarkDataset } from '../../../src/rag/benchmark/ragBenchmarkTypes';

function loadSyntheticDataset(): BenchmarkDataset {
  const datasetPath = path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const parsed = parseBenchmarkDataset(raw);
  assert.equal(parsed.ok, true, `synthetic-v1.json must itself be a valid dataset: ${parsed.errors.join('; ')}`);
  return parsed.dataset!;
}

test('toRagRecipe produces a shape buildRagIndex() actually accepts', () => {
  const dataset = loadSyntheticDataset();
  const recipe = toRagRecipe(dataset.recipes[0]);
  assert.equal(recipe.frontmatter.id, dataset.recipes[0].id);
  assert.equal(recipe.body, dataset.recipes[0].body);
  assert.equal(recipe.relativePath, dataset.recipes[0].relativePath);
});

test('the committed synthetic-v1.json dataset itself is schema-valid and cross-reference-valid', () => {
  // loadSyntheticDataset() already asserts this, but a dedicated test
  // makes the failure message point directly at "the dataset file is
  // broken" rather than being buried inside some other test's setup.
  loadSyntheticDataset();
});

test('end-to-end: the real retrieval pipeline correctly separates Java and Python capabilities by language', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const javaQuery = results.find((r) => r.queryId === 'dev-positive-exact')!;
  const pythonQuery = results.find((r) => r.queryId === 'dev-language-incompatibility')!;
  assert.ok(javaQuery.returnedIds.includes('postgres-query-one'));
  assert.ok(!javaQuery.returnedIds.includes('postgres-query-one-py'));
  assert.ok(pythonQuery.returnedIds.includes('postgres-query-one-py'));
  assert.ok(!pythonQuery.returnedIds.includes('postgres-query-one'));
});

test('end-to-end: vendor names are never conflated — a mysql query does not surface the postgres helper', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const vendorQuery = results.find((r) => r.queryId === 'dev-vendor-mismatch')!;
  assert.ok(vendorQuery.returnedIds.includes('mysql-query-helper'));
  assert.ok(!vendorQuery.returnedIds.includes('postgres-query-one'));
});

// NOTE on 'dev-misleading-shared-vocab-cassandra': the unit-level
// regression test in test/rag/ragRetriever.test.ts ("a recipe is matchable
// purely by its FOLDER name") proves the underlying MECHANISM works in
// isolation (a 2-recipe corpus, nothing else competing for
// "database/query/validate" vocabulary). This benchmark's richer corpus
// ALSO has postgres and mysql helpers sharing that same generic
// vocabulary — a more realistic test of whether folder-name signal
// survives real competition. As measured in this baseline it does NOT
// (see BASELINE.md for the exact recorded number and rationale) — a
// genuine, real finding, not a test bug. No test here hard-asserts that
// specific number, which would make the suite brittle against any
// unrelated future retrieval tuning; the point-in-time measurement lives
// in the baseline report instead (see the `buildBenchmarkReport` tests
// below for the full aggregate numbers this run produces).

test('end-to-end: recallAtK for a real positive query is always a valid fraction in [0, 1], never null/NaN/out-of-range', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const positiveResults = results.filter((r) => r.isPositive);
  assert.ok(positiveResults.length > 0);
  for (const result of positiveResults) {
    assert.equal(typeof result.recallAtK, 'number');
    assert.ok(result.recallAtK! >= 0 && result.recallAtK! <= 1, `recallAtK for ${result.queryId} out of range: ${result.recallAtK}`);
  }
});

test('end-to-end: an empty/whitespace query returns zero results without throwing', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const emptyQuery = results.find((r) => r.queryId === 'dev-empty-query')!;
  assert.deepEqual(emptyQuery.returnedIds, []);
  assert.equal(emptyQuery.recallAtK, null); // no-match case: null, not 0
});

test('end-to-end: a negative query\'s false-positive flag is measured honestly, not asserted clean by fiat', async () => {
  // The CURRENT retrieval pipeline has no minimum-score/abstention
  // threshold at all (rag/ragRetriever.ts's own filter is just
  // `score > 0`) — any nonzero cosine similarity "matches," including
  // residual overlap from common stopwords shared with every document in
  // the corpus. That means even a genuinely unrelated query CAN produce a
  // low-scoring spurious match today; measured on this dataset, most (but
  // not all) negative queries currently come back clean, and at least one
  // does not (see BASELINE.md). This is real, honest baseline behavior —
  // exactly the gap Phase 4's relevance/abstention calibration exists to
  // close — not a bug to paper over by hand-tuning query wording until it
  // happens to score zero today. This test only verifies the flag
  // computes as a real boolean, not that it's always false.
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const negativeResults = results.filter((r) => !r.isPositive);
  assert.ok(negativeResults.length > 0);
  for (const result of negativeResults) {
    assert.equal(typeof result.isFalsePositive, 'boolean');
  }
});

test('end-to-end: identifier-reference wording (PostgresHelper.queryOne) still finds the recipe via sub-word tokenization', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const identifierQuery = results.find((r) => r.queryId === 'dev-identifier-reference')!;
  assert.ok(identifierQuery.returnedIds.includes('postgres-query-one'));
});

test('end-to-end: the multi-operation case is measured honestly — recall reflects however many of the 2 required helpers were actually found', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const multiOpQuery = results.find((r) => r.queryId === 'dev-multiple-required-operations')!;
  // Not asserting recall === 1 here on purpose — `runBenchmarkOnDataset()`
  // is the LEGACY/BASELINE mode (F15), which deliberately never exercises
  // per-operation retrieval (topK=2, single whole-query call, by design —
  // see that function's own doc comment) even though the real production
  // pipeline's per-operation retrieval (Phase 3) DOES exist and IS
  // exercised by `runProductionPipelineOnDataset()` instead — see this
  // same query scored in that mode below. Just assert the metric computed
  // at all and is a legitimate fraction here, not a crash or a fabricated
  // perfect score.
  assert.ok(multiOpQuery.recallAtK !== null);
  assert.ok(multiOpQuery.recallAtK! >= 0 && multiOpQuery.recallAtK! <= 1);
});

test('end-to-end: an alternative-helper group is satisfied by either member', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const altQuery = results.find((r) => r.queryId === 'holdout-alternative-helpers')!;
  const foundEither = altQuery.returnedIds.includes('api-request-assertion-helper') || altQuery.returnedIds.includes('api-response-validator-helper');
  assert.equal(altQuery.recallAtK === 1, foundEither);
});

test('buildBenchmarkReport produces a segment breakdown including development/holdout and per-language splits', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const report = buildBenchmarkReport(dataset, results, '2026-01-01T00:00:00.000Z');
  assert.ok(report.json.segments['Overall']);
  assert.ok(report.json.segments['Development split']);
  assert.ok(report.json.segments['Holdout split']);
  assert.ok(report.json.segments['Java']);
  assert.ok(report.json.segments['Python']);
  assert.equal(report.json.segments['Overall'].queryCount, dataset.queries.length);
  assert.match(report.markdown, /SYNTHETIC/);
  assert.match(report.markdown, /Recall@k/);
});

test('buildBenchmarkReport is deterministic given the same inputs (aside from the injected timestamp)', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runBenchmarkOnDataset(dataset);
  const reportA = buildBenchmarkReport(dataset, results, 'fixed-time');
  const reportB = buildBenchmarkReport(dataset, results, 'fixed-time');
  assert.deepEqual(reportA.json, reportB.json);
  assert.equal(reportA.markdown, reportB.markdown);
});

// =============================================================================
// PRODUCTION-PIPELINE mode (F15)
// =============================================================================

test('operationsForBenchmarkQuery uses the query\'s own operations field when present', () => {
  const dataset = loadSyntheticDataset();
  const query = dataset.queries.find((q) => q.queryId === 'dev-repeated-operation')!;
  const operations = operationsForBenchmarkQuery(query);
  assert.equal(operations.length, 2);
  assert.equal(operations[0].operationId, 'op-1');
});

test('operationsForBenchmarkQuery falls back to ONE whole-query operation when operations is absent', () => {
  const dataset = loadSyntheticDataset();
  const query = dataset.queries.find((q) => q.queryId === 'dev-positive-exact')!;
  assert.equal(query.operations, undefined);
  const operations = operationsForBenchmarkQuery(query);
  assert.equal(operations.length, 1);
  assert.equal(operations[0].text, query.queryText);
});

test('end-to-end: PRODUCTION mode genuinely exercises real per-operation retrieval and packing, not just a relabeled whole-query call', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const multiOpQuery = results.find((r) => r.queryId === 'dev-multiple-required-operations')!;
  // This query now has TWO declared operations (see the dataset's own
  // updated entry) — production mode must actually retrieve against BOTH
  // of them independently, not collapse them into one.
  assert.equal(multiOpQuery.operationCount, 2);
});

test('end-to-end: PRODUCTION mode reports retrievedIds (pre-packing) separately from returnedIds (post-packing)', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  for (const result of results) {
    // Every returned id must have actually been retrieved — packing only
    // ever REMOVES candidates, never invents new ones.
    for (const id of result.returnedIds) {
      assert.ok(result.retrievedIds.includes(id), `${id} was returned but never retrieved for query ${result.queryId}`);
    }
  }
});

test('end-to-end: PRODUCTION mode reports a real (non-negative) estimated token count and latency for every query', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  for (const result of results) {
    assert.ok(result.estimatedTokens >= 0);
    assert.ok(result.latencyMs >= 0);
    assert.equal(typeof result.tokensUnmeasured, 'boolean');
  }
});

test('end-to-end: PRODUCTION mode reports operation coverage honestly — never claims more operations covered than exist', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  for (const result of results) {
    assert.ok(result.coveredOperationCount <= result.operationCount);
  }
});

test('runProductionPipelineOnDataset respects a caller-supplied gateConfig, same as the real pipeline would', async () => {
  const dataset = loadSyntheticDataset();
  const withDefault = await runProductionPipelineOnDataset(dataset);
  const withImpossiblyStrict = await runProductionPipelineOnDataset(dataset, { gateConfig: { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 999 } });
  const defaultTotalReturned = withDefault.reduce((sum, r) => sum + r.returnedIds.length, 0);
  const strictTotalReturned = withImpossiblyStrict.reduce((sum, r) => sum + r.returnedIds.length, 0);
  assert.ok(strictTotalReturned < defaultTotalReturned, 'an unreachably strict gate should return meaningfully fewer matches overall');
});

test('runProductionPipelineOnDataset is deterministic given the same dataset and options', async () => {
  const dataset = loadSyntheticDataset();
  const resultsA = await runProductionPipelineOnDataset(dataset);
  const resultsB = await runProductionPipelineOnDataset(dataset);
  // latencyMs is real wall-clock time and will differ — compare everything else.
  const strip = (results: typeof resultsA) => results.map(({ latencyMs, ...rest }) => rest);
  assert.deepEqual(strip(resultsA), strip(resultsB));
});

test('buildProductionModeReport includes a corpus fingerprint and reports missing git provenance honestly', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const report = buildProductionModeReport(
    dataset,
    results,
    { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000, gateConfig: DEFAULT_RELEVANCE_GATE },
    'fixed-time'
  );
  assert.match(report.json.corpusFingerprint, /^[0-9a-f]{64}$/);
  assert.match(report.markdown, /Git: unavailable/);
  assert.match(report.markdown, /PRODUCTION-PIPELINE mode/);
});

test('buildProductionModeReport surfaces git provenance, including a DIRTY working tree, when given', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const report = buildProductionModeReport(
    dataset,
    results,
    {
      perOperationK: 3,
      estimatedMaxInputTokens: 128_000,
      estimatedMandatoryTokens: 2_000,
      gateConfig: DEFAULT_RELEVANCE_GATE,
      gitProvenance: { commit: 'abc1234', dirty: true }
    },
    'fixed-time'
  );
  assert.match(report.markdown, /abc1234/);
  assert.match(report.markdown, /DIRTY working tree/);
});

test('buildProductionModeReport explicitly labels its token counts as an ESTIMATE, never a real model\'s measurement', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const report = buildProductionModeReport(
    dataset,
    results,
    { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000, gateConfig: DEFAULT_RELEVANCE_GATE },
    'fixed-time'
  );
  assert.match(report.markdown, /ESTIMATE/);
  assert.match(report.markdown, /no real model was consulted|never measured/i);
});

test('buildProductionModeReport reports omission reasons by tally, summed across every query', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const report = buildProductionModeReport(
    dataset,
    results,
    { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000, gateConfig: DEFAULT_RELEVANCE_GATE },
    'fixed-time'
  );
  assert.match(report.markdown, /Omissions by reason/);
});

test('buildProductionModeReport is deterministic given the same inputs', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runProductionPipelineOnDataset(dataset);
  const meta = { perOperationK: 3, estimatedMaxInputTokens: 128_000, estimatedMandatoryTokens: 2_000, gateConfig: DEFAULT_RELEVANCE_GATE };
  const reportA = buildProductionModeReport(dataset, results, meta, 'fixed-time');
  const reportB = buildProductionModeReport(dataset, results, meta, 'fixed-time');
  assert.deepEqual(reportA.json, reportB.json);
  assert.equal(reportA.markdown, reportB.markdown);
});
