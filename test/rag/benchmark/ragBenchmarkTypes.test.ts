import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseBenchmarkDataset, validateBenchmarkDataset, BenchmarkDataset } from '../../../src/rag/benchmark/ragBenchmarkTypes';

function baseRecipe(id: string) {
  return {
    id,
    title: `Recipe ${id}`,
    tags: ['tag'],
    automationMode: ['ui', 'api'],
    language: ['java'],
    relativePath: `${id}.md`,
    body: `Body for ${id}`
  };
}

function baseQuery(queryId: string, relevantIds: string[] = []) {
  return {
    queryId,
    language: 'java',
    automationMode: 'ui',
    split: 'development',
    origin: 'synthetic',
    datasetVersion: '1',
    queryText: `Query text for ${queryId}`,
    relevantIds,
    rationale: 'test fixture'
  };
}

function validDataset(): BenchmarkDataset {
  return {
    datasetVersion: '1',
    recipes: [baseRecipe('r1'), baseRecipe('r2')] as BenchmarkDataset['recipes'],
    queries: [baseQuery('q1', ['r1']), baseQuery('q2', [])] as BenchmarkDataset['queries']
  };
}

test('a well-formed dataset parses and validates cleanly', () => {
  const result = parseBenchmarkDataset(validDataset());
  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.ok(result.dataset);
});

test('rejects a dataset that fails basic schema shape (missing required field)', () => {
  const dataset = validDataset() as any;
  delete dataset.queries[0].rationale;
  const result = parseBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length > 0);
  assert.equal(result.dataset, undefined);
});

test('rejects an invalid language/automationMode enum value', () => {
  const dataset = validDataset() as any;
  dataset.queries[0].language = 'rust';
  const result = parseBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
});

test('detects a DUPLICATE recipe id', () => {
  const dataset = validDataset();
  dataset.recipes.push(baseRecipe('r1') as any);
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Duplicate recipe id')));
});

test('detects a DUPLICATE query id', () => {
  const dataset = validDataset();
  dataset.queries.push(baseQuery('q1', ['r2']) as any);
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('Duplicate query id')));
});

test('detects an UNRESOLVED reference in relevantIds', () => {
  const dataset = validDataset();
  (dataset.queries[0] as any).relevantIds = ['does-not-exist'];
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unknown recipe id "does-not-exist"')));
});

test('detects an UNRESOLVED reference in alternativeGroups', () => {
  const dataset = validDataset();
  (dataset.queries[0] as any).alternativeGroups = [['r1', 'ghost']];
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('unknown recipe id "ghost"')));
});

test('detects an UNRESOLVED reference in gradedRelevance', () => {
  const dataset = validDataset();
  (dataset.queries[0] as any).gradedRelevance = { ghost: 1 };
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('gradedRelevance')));
});

test('an empty relevantIds with a NON-EMPTY alternativeGroups is a VALID positive query, not a contradiction', () => {
  // The query's sole requirement is expressed entirely via the
  // alternative group — that's a normal, legitimate way to label "any one
  // of these helpers satisfies this," not a contradiction.
  const dataset = validDataset();
  (dataset.queries[1] as any).alternativeGroups = [['r1', 'r2']]; // q2 has relevantIds: []
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, true);
});

test('detects a CONTRADICTORY no-match label (empty relevantIds but non-empty gradedRelevance)', () => {
  const dataset = validDataset();
  (dataset.queries[1] as any).gradedRelevance = { r1: 2 };
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('contradictory')));
});

test('detects a DUPLICATE operationId within one query', () => {
  const dataset = validDataset();
  (dataset.queries[0] as any).operations = [
    { operationId: 'op1', text: 'do a' },
    { operationId: 'op1', text: 'do b' }
  ];
  const result = validateBenchmarkDataset(dataset);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('duplicate operationId')));
});

test('a query with an empty relevantIds and no alternatives/gradedRelevance is a VALID no-match case, not an error', () => {
  const result = validateBenchmarkDataset(validDataset());
  assert.equal(result.ok, true);
});

test('reports MULTIPLE errors at once rather than stopping at the first', () => {
  const dataset = validDataset();
  dataset.recipes.push(baseRecipe('r1') as any); // duplicate recipe
  dataset.queries.push(baseQuery('q1', ['ghost']) as any); // duplicate query id + unresolved ref
  const result = validateBenchmarkDataset(dataset);
  assert.ok(result.errors.length >= 3);
});
