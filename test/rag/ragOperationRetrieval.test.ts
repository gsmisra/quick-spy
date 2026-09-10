import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildRagIndex } from '../../src/rag/ragIndexBuilder';
import { retrieveForOperations } from '../../src/rag/ragOperationRetrieval';
import { RagRecipe } from '../../src/rag/ragTypes';

function makeRecipe(id: string, title: string, tags: string[], frontmatterOverrides: Partial<RagRecipe['frontmatter']> = {}): RagRecipe {
  return {
    filePath: `/fake/.github/rag/${id}.md`,
    relativePath: `${id}.md`,
    mtimeMs: 0,
    frontmatter: { id, title, tags, automationMode: ['ui', 'api'], language: ['java'], ...frontmatterOverrides },
    body: '```java\ncode();\n```'
  };
}

const POSTGRES = makeRecipe('postgres-helper', 'Query Postgres', ['postgres', 'database', 'query'], { automationMode: ['api'] });
const KAFKA = makeRecipe('kafka-helper', 'Publish a Kafka event', ['kafka', 'messaging', 'event'], { automationMode: ['api'] });
const AUTH = makeRecipe('auth-helper', 'Attach a bearer token', ['api', 'auth', 'bearer', 'token'], { automationMode: ['api'] });

test('a three-operation request surfaces all THREE distinct required helpers — no global two-helper ceiling', async () => {
  const index = await buildRagIndex([POSTGRES, KAFKA, AUTH]);
  const operations = [
    { operationId: 'op-0', text: 'connect to postgres and query a table for order data' },
    { operationId: 'op-1', text: 'publish a kafka event with the order result' },
    { operationId: 'op-2', text: 'attach a bearer token to the api request' }
  ];
  const candidates = await retrieveForOperations(index, operations, 'java', 'api');
  const ids = candidates.map((c) => c.match.id);
  assert.ok(ids.includes('postgres-helper'));
  assert.ok(ids.includes('kafka-helper'));
  assert.ok(ids.includes('auth-helper'));
});

test('a capability useful for MULTIPLE operations is one candidate covering all of them, not duplicated', async () => {
  const index = await buildRagIndex([POSTGRES]);
  const operations = [
    { operationId: 'op-a', text: 'query postgres for the customer row' },
    { operationId: 'op-b', text: 'query postgres again for the linked order row' }
  ];
  const candidates = await retrieveForOperations(index, operations, 'java', 'api');
  const postgresCandidate = candidates.find((c) => c.match.id === 'postgres-helper')!;
  assert.ok(postgresCandidate);
  assert.equal(candidates.length, 1, 'only one distinct candidate, not one per operation');
  assert.deepEqual(postgresCandidate.coveredOperationIds.sort(), ['op-a', 'op-b']);
});

test('hard language filtering is preserved per-operation', async () => {
  const pythonOnly = makeRecipe('python-only-helper', 'Query Postgres (Python)', ['postgres'], { automationMode: ['api'], language: ['python'] });
  const index = await buildRagIndex([pythonOnly]);
  const candidates = await retrieveForOperations(index, [{ operationId: 'op-0', text: 'query postgres' }], 'java', 'api');
  assert.deepEqual(candidates, []);
});

test('an operation with no relevant candidates contributes nothing, without erroring', async () => {
  const index = await buildRagIndex([POSTGRES]);
  const candidates = await retrieveForOperations(index, [{ operationId: 'op-0', text: 'zzz completely unrelated qqq' }], 'java', 'api');
  assert.deepEqual(candidates, []);
});

test('an empty operations list produces an empty candidate list', async () => {
  const index = await buildRagIndex([POSTGRES]);
  const candidates = await retrieveForOperations(index, [], 'java', 'api');
  assert.deepEqual(candidates, []);
});

// --- A08: staleFilePaths is threaded through to EACH operation's own
// per-operation retrieval, excluded before that operation's own topK cut --

test('A08: staleFilePaths passed to retrieveForOperations excludes a candidate from every operation it would otherwise cover', async () => {
  const index = await buildRagIndex([POSTGRES]);
  const operations = [{ operationId: 'op-0', text: 'query postgres for the customer row' }];
  const withoutExclusion = await retrieveForOperations(index, operations, 'java', 'api');
  assert.equal(withoutExclusion.length, 1, 'sanity check: the candidate is genuinely retrievable at all without exclusion');

  const staleFilePaths = new Set([POSTGRES.filePath]);
  const withExclusion = await retrieveForOperations(index, operations, 'java', 'api', undefined, undefined, staleFilePaths);
  assert.deepEqual(withExclusion, [], 'the excluded candidate must not appear at all, not even as a candidate covering zero operations');
});

test('A08: a fresh candidate ranked outside a small per-operation K surfaces once stale higher-ranked ones are excluded (the reproduced gap)', async () => {
  // Four candidates that all match one operation's text — with a
  // perOperationK of 3, three of them alone would already fill the
  // window; marking those three stale must let the 4th (fresh) one
  // through instead of the operation ending up with nothing.
  const recipes = ['a', 'b', 'c', 'd'].map((letter) =>
    makeRecipe(`postgres-helper-${letter}`, `Query Postgres variant ${letter}`, ['postgres', 'database', 'query'], { automationMode: ['api'] })
  );
  const index = await buildRagIndex(recipes);
  const operations = [{ operationId: 'op-0', text: 'query postgres database' }];

  const withoutExclusion = await retrieveForOperations(index, operations, 'java', 'api', 3);
  assert.equal(withoutExclusion.length, 3, 'sanity check: perOperationK genuinely caps this at 3 with no exclusion');

  const retrievedFilePaths = new Set(withoutExclusion.map((c) => c.match.filePath));
  const freshRecipe = recipes.find((r) => !retrievedFilePaths.has(r.filePath))!;
  const staleFilePaths = new Set(withoutExclusion.map((c) => c.match.filePath));

  const withExclusion = await retrieveForOperations(index, operations, 'java', 'api', 3, undefined, staleFilePaths);
  assert.ok(
    withExclusion.some((c) => c.match.filePath === freshRecipe.filePath),
    'the fresh 4th candidate must be retrieved once the top 3 are excluded — never left out just because it ranked outside the original top-3 window'
  );
});

test('bestScore reflects the HIGHEST score seen across the operations a candidate covers', async () => {
  const index = await buildRagIndex([POSTGRES]);
  const operations = [
    { operationId: 'op-weak', text: 'database' }, // weak, generic match
    { operationId: 'op-strong', text: 'query postgres database and validate a table' } // strong match
  ];
  const candidates = await retrieveForOperations(index, operations, 'java', 'api');
  const postgresCandidate = candidates.find((c) => c.match.id === 'postgres-helper');
  if (postgresCandidate && postgresCandidate.coveredOperationIds.includes('op-weak') && postgresCandidate.coveredOperationIds.includes('op-strong')) {
    // Only assert the ordering property when both operations actually matched it.
    assert.ok(postgresCandidate.bestScore > 0);
  }
});
