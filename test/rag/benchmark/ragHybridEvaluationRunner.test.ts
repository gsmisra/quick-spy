import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { runHybridEvaluation, buildHybridEvaluationReport } from '../../../src/rag/benchmark/ragHybridEvaluationRunner';
import { CharNgramStandInProvider } from '../../../src/rag/benchmark/ragCharNgramStandInProvider';
import { parseBenchmarkDataset, BenchmarkDataset } from '../../../src/rag/benchmark/ragBenchmarkTypes';

function loadSyntheticDataset(): BenchmarkDataset {
  const datasetPath = path.join(__dirname, '..', '..', '..', '..', 'benchmarks', 'rag', 'datasets', 'synthetic-v1.json');
  const raw = JSON.parse(fs.readFileSync(datasetPath, 'utf8'));
  const parsed = parseBenchmarkDataset(raw);
  assert.equal(parsed.ok, true);
  return parsed.dataset!;
}

test('runHybridEvaluation against the real synthetic dataset produces development, holdout, and all rows', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider();
  const results = await runHybridEvaluation(dataset, provider);
  const splits = results.map((r) => r.split);
  assert.ok(splits.includes('development'));
  assert.ok(splits.includes('holdout'));
  assert.ok(splits.includes('all'));
});

test('the "all" row\'s query count equals development + holdout combined', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider();
  const results = await runHybridEvaluation(dataset, provider);
  const dev = results.find((r) => r.split === 'development')!;
  const holdout = results.find((r) => r.split === 'holdout')!;
  const all = results.find((r) => r.split === 'all')!;
  assert.equal(all.queryCount, dev.queryCount + holdout.queryCount);
});

test('every split reports BOTH lexicalOnly and hybrid metrics, never just one', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider();
  const results = await runHybridEvaluation(dataset, provider);
  for (const result of results) {
    assert.ok(result.lexicalOnly);
    assert.ok(result.hybrid);
    assert.equal(result.lexicalOnly.queryCount, result.queryCount);
    assert.equal(result.hybrid.queryCount, result.queryCount);
  }
});

test('runHybridEvaluation is deterministic given the same dataset and provider', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider();
  const resultsA = await runHybridEvaluation(dataset, provider);
  const resultsB = await runHybridEvaluation(dataset, provider);
  assert.deepEqual(resultsA, resultsB);
});

test('buildHybridEvaluationReport labels a stand-in-provider run with the explicit non-semantic warning', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider();
  const results = await runHybridEvaluation(dataset, provider);
  const report = buildHybridEvaluationReport(dataset, results, provider.id, true, 'fixed-time');
  assert.equal(report.json.isStandInProvider, true);
  assert.match(report.markdown, /NON-SEMANTIC/);
  assert.match(report.markdown, /NOT evidence that real semantic embeddings would improve retrieval accuracy/);
});

test('buildHybridEvaluationReport labels a real-provider run WITHOUT the stand-in warning', async () => {
  const dataset = loadSyntheticDataset();
  const provider = new CharNgramStandInProvider(); // stand-in used mechanically here too, but isStandInProvider flag is caller-supplied
  const results = await runHybridEvaluation(dataset, provider);
  const report = buildHybridEvaluationReport(dataset, results, 'http:https://real-endpoint:real-model', false, 'fixed-time');
  assert.equal(report.json.isStandInProvider, false);
  assert.doesNotMatch(report.markdown, /NON-SEMANTIC/);
  assert.match(report.markdown, /REAL configured semantic embedding provider/);
});

test('buildHybridEvaluationReport marks PROVISIONAL when the dataset includes synthetic-origin queries', async () => {
  const dataset = loadSyntheticDataset(); // synthetic-v1 — all synthetic
  const results = await runHybridEvaluation(dataset, new CharNgramStandInProvider());
  const report = buildHybridEvaluationReport(dataset, results, 'x', true, 'fixed-time');
  assert.equal(report.json.provisional, true);
  assert.match(report.markdown, /PROVISIONAL/);
});

test('buildHybridEvaluationReport never claims to have selected or promoted any configuration', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runHybridEvaluation(dataset, new CharNgramStandInProvider());
  const report = buildHybridEvaluationReport(dataset, results, 'x', true, 'fixed-time');
  assert.match(report.markdown, /comparison only/);
});

test('buildHybridEvaluationReport is deterministic given the same inputs', async () => {
  const dataset = loadSyntheticDataset();
  const results = await runHybridEvaluation(dataset, new CharNgramStandInProvider());
  const reportA = buildHybridEvaluationReport(dataset, results, 'x', true, 'fixed-time');
  const reportB = buildHybridEvaluationReport(dataset, results, 'x', true, 'fixed-time');
  assert.deepEqual(reportA, reportB);
});
