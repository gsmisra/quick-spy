import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  planOperationsFromGherkinSteps,
  planOperationFromApiRequest,
  planOperationsFromAgenticSegments,
  planUnstructuredOperation,
  withSharedContext,
  chunkTextForOperations
} from '../../src/rag/ragOperationPlanner';

// --- planOperationsFromGherkinSteps ----------------------------------------

test('one operation per selected step, in order', () => {
  const plan = planOperationsFromGherkinSteps(['Given a', 'When b', 'Then c'], undefined, []);
  assert.equal(plan.method, 'gherkin-steps');
  assert.equal(plan.operations.length, 3);
  assert.match(plan.operations[0].text, /Given a/);
  assert.match(plan.operations[1].text, /When b/);
  assert.match(plan.operations[2].text, /Then c/);
});

test('DESELECTED steps are never reintroduced — this function only ever sees what was already selected', () => {
  // Simulates a scenario where step "Given a" was deselected upstream —
  // this function receives ONLY the selected steps and has no way to
  // reach back for the deselected one.
  const plan = planOperationsFromGherkinSteps(['When b', 'Then c'], undefined, []);
  assert.equal(plan.operations.length, 2);
  assert.ok(!plan.operations.some((op) => op.text.includes('Given a')));
});

test('Background text is folded into EVERY step operation as shared context, not its own operation', () => {
  const plan = planOperationsFromGherkinSteps(['When b'], 'Given I am logged in as an admin', []);
  assert.equal(plan.operations.length, 1); // still just 1 operation, not 2
  assert.match(plan.operations[0].text, /logged in as an admin/);
  assert.match(plan.operations[0].text, /When b/);
});

test('Examples text is folded into every step operation as shared context too', () => {
  const plan = planOperationsFromGherkinSteps(['When step <a>'], undefined, ['Examples:\n| a |\n| 1 |']);
  assert.equal(plan.operations.length, 1);
  assert.match(plan.operations[0].text, /Examples:/);
});

test('with zero selected steps but real Background/Examples context, ONE context-only operation is produced', () => {
  const plan = planOperationsFromGherkinSteps([], 'Given a precondition', []);
  assert.equal(plan.operations.length, 1);
  assert.match(plan.operations[0].text, /a precondition/);
});

test('with zero selected steps and no context at all, zero operations are produced', () => {
  const plan = planOperationsFromGherkinSteps([], undefined, []);
  assert.deepEqual(plan.operations, []);
});

test('a step consisting only of whitespace is dropped rather than producing an empty operation', () => {
  const plan = planOperationsFromGherkinSteps(['Given a', '   '], undefined, []);
  assert.equal(plan.operations.length, 1);
});

// --- planOperationFromApiRequest --------------------------------------------

test('produces exactly ONE operation combining method+URL and field names', () => {
  const plan = planOperationFromApiRequest('POST /api/orders', ['customerId', 'cardNumber']);
  assert.equal(plan.method, 'api-fields');
  assert.equal(plan.operations.length, 1);
  assert.match(plan.operations[0].text, /POST \/api\/orders/);
  assert.match(plan.operations[0].text, /customerId/);
  assert.match(plan.operations[0].text, /cardNumber/);
});

test('an empty method/URL and no field names produces zero operations', () => {
  const plan = planOperationFromApiRequest('', []);
  assert.deepEqual(plan.operations, []);
});

test('works with just method+URL and no field names at all', () => {
  const plan = planOperationFromApiRequest('GET /api/health', []);
  assert.equal(plan.operations.length, 1);
  assert.match(plan.operations[0].text, /GET \/api\/health/);
});

// --- planOperationsFromAgenticSegments --------------------------------------

test('produces one operation for the user request PLUS one per file segment', () => {
  const plan = planOperationsFromAgenticSegments('generate tests for checkout', [
    { fileName: 'a.csv', text: 'header1,header2\nval1,val2' },
    { fileName: 'b.json', text: '{"key":"value"}' }
  ]);
  assert.equal(plan.method, 'agentic-segments');
  assert.equal(plan.operations.length, 3);
  assert.equal(plan.operations[0].operationId, 'user-request');
  assert.match(plan.operations[0].text, /checkout/);
  assert.match(plan.operations[1].text, /header1/);
  assert.match(plan.operations[2].text, /key.*value/);
});

test('a LATER file segment is never dropped — this is the fix for the leading-slice bug', () => {
  const manySegments = Array.from({ length: 10 }, (_, i) => ({ fileName: `file${i}.txt`, text: `unique-content-marker-${i}` }));
  const plan = planOperationsFromAgenticSegments('', manySegments);
  // Every single file, including the LAST one, gets its own operation.
  assert.equal(plan.operations.length, 10);
  assert.match(plan.operations[9].text, /unique-content-marker-9/);
});

test('an empty user request produces no "user-request" operation, only file operations', () => {
  const plan = planOperationsFromAgenticSegments('   ', [{ fileName: 'a.txt', text: 'content' }]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].operationId, 'file-0');
});

test('a blank file segment is skipped rather than producing an empty operation', () => {
  const plan = planOperationsFromAgenticSegments('do something', [{ fileName: 'empty.txt', text: '   ' }]);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].operationId, 'user-request');
});

test('no user request and no file segments at all produces zero operations', () => {
  const plan = planOperationsFromAgenticSegments('', []);
  assert.deepEqual(plan.operations, []);
});

// --- chunkTextForOperations (F13) --------------------------------------------

test('a short text (already within the target size) produces exactly ONE chunk, unchanged', () => {
  const text = 'a short requirement.';
  const chunks = chunkTextForOperations(text, 600, 12);
  assert.deepEqual(chunks, [text]);
});

test('an empty or whitespace-only text produces zero chunks', () => {
  assert.deepEqual(chunkTextForOperations('', 600, 12), []);
  assert.deepEqual(chunkTextForOperations('   \n  ', 600, 12), []);
});

test('a distinctive requirement mentioned only at the very END of a long document is captured by a LATER chunk (the reproduced F13 bug)', () => {
  // ~6,000 chars of filler followed by one distinctive marker at the very
  // end — the OLD behavior (a single 600-char leading slice) could never
  // see this at all.
  const filler = 'This document describes general background information with no distinctive terms. '.repeat(70);
  const text = `${filler}\nCRITICAL: must use the DistinctiveHelperXyz123 utility for this step.`;
  const chunks = chunkTextForOperations(text, 600, 12);
  assert.ok(chunks.length > 1, 'a document this long must produce more than one chunk');
  assert.ok(
    chunks.some((c) => c.includes('DistinctiveHelperXyz123')),
    'the marker mentioned only at the end must appear in SOME chunk'
  );
});

test('every character of the original text is covered by SOME chunk — nothing is silently dropped', () => {
  const words = Array.from({ length: 500 }, (_, i) => `word${i}`);
  const text = words.join(' ');
  const chunks = chunkTextForOperations(text, 200, 20);
  const rejoined = chunks.join(' ');
  for (const word of words) {
    assert.ok(rejoined.includes(word), `expected "${word}" to survive in some chunk`);
  }
});

test('the total chunk count never exceeds maxChunks, no matter how long the text is', () => {
  const hugeText = 'word '.repeat(60_000 / 5); // ~60,000 chars, matching AGENTIC_MAX_SEGMENT_CHARS
  const chunks = chunkTextForOperations(hugeText, 600, 12);
  assert.ok(chunks.length <= 12, `expected at most 12 chunks, got ${chunks.length}`);
});

test('chunking a very long text still covers content near the end, even when the chunk cap forces larger chunks', () => {
  const filler = 'filler word '.repeat(5000); // ~60,000 chars
  const text = `${filler}FINAL_MARKER_AT_THE_VERY_END`;
  const chunks = chunkTextForOperations(text, 600, 12);
  assert.ok(chunks.length <= 12);
  assert.ok(chunks.some((c) => c.includes('FINAL_MARKER_AT_THE_VERY_END')));
});

test('is deterministic — chunking the same text twice produces identical results', () => {
  const text = 'one two three four five six seven eight nine ten. '.repeat(50);
  assert.deepEqual(chunkTextForOperations(text, 100, 10), chunkTextForOperations(text, 100, 10));
});

test('prefers breaking on whitespace rather than mid-word when a nearby break exists', () => {
  const text = `${'x'.repeat(90)} distinctword ${'y'.repeat(90)}`;
  const chunks = chunkTextForOperations(text, 100, 5);
  // A break exists at char 90 (the space right before "distinctword"),
  // well within reach of the 100-char target — the first chunk should end
  // exactly there rather than 10 characters into "distinctword".
  assert.equal(chunks[0], 'x'.repeat(90));
});

// --- planOperationsFromAgenticSegments + chunking, end-to-end (F13) ---------

test('a file whose segment is chunked produces MULTIPLE operations, one per chunk, each independently retrievable', () => {
  const filler = 'This document describes general background information with no distinctive terms. '.repeat(70);
  const text = `${filler}\nCRITICAL: must use the DistinctiveHelperXyz123 utility for this step.`;
  const chunks = chunkTextForOperations(text, 600, 12);
  const fileSegments = chunks.map((chunkText, i) => ({ fileName: `requirements.txt (part ${i + 1}/${chunks.length})`, text: chunkText }));
  const plan = planOperationsFromAgenticSegments('', fileSegments);
  assert.equal(plan.operations.length, chunks.length);
  assert.ok(plan.operations.some((op) => op.text.includes('DistinctiveHelperXyz123')));
});

// --- planUnstructuredOperation -----------------------------------------------

test('wraps arbitrary text as exactly one operation', () => {
  const plan = planUnstructuredOperation('some free-text instructions with no other structure');
  assert.equal(plan.method, 'unstructured-fallback');
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].text, 'some free-text instructions with no other structure');
});

test('empty text produces zero operations', () => {
  const plan = planUnstructuredOperation('   ');
  assert.deepEqual(plan.operations, []);
});

// --- withSharedContext -------------------------------------------------------

test('prepends shared context onto EVERY operation in the plan', () => {
  const plan = planOperationsFromGherkinSteps(['Given a', 'When b'], undefined, []);
  const result = withSharedContext(plan, 'also validate using the audit-log helper');
  assert.equal(result.operations.length, 2);
  assert.ok(result.operations.every((op) => op.text.includes('audit-log helper')));
  assert.match(result.operations[0].text, /Given a/);
  assert.match(result.operations[1].text, /When b/);
});

test('is a no-op when shared context is empty/whitespace', () => {
  const plan = planOperationsFromGherkinSteps(['Given a'], undefined, []);
  const result = withSharedContext(plan, '   ');
  assert.deepEqual(result, plan);
});

test('produces ONE operation from shared context alone when the plan had zero operations', () => {
  const emptyPlan = planUnstructuredOperation('');
  const result = withSharedContext(emptyPlan, 'some real chat-box instructions');
  assert.equal(result.operations.length, 1);
  assert.match(result.operations[0].text, /some real chat-box instructions/);
});

test('preserves the original plan\'s method label', () => {
  const plan = planOperationFromApiRequest('POST /api/orders', []);
  const result = withSharedContext(plan, 'extra context');
  assert.equal(result.method, 'api-fields');
});
