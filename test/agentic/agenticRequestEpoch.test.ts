import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { isStaleRequest, CancellationSourceLike } from '../../src/agentic/agenticRequestEpoch';

function fakeSource(isCancellationRequested = false): CancellationSourceLike {
  return { token: { isCancellationRequested } };
}

// --- A13: the exact reproduced gap — a request must be recognized as stale
// EITHER because it was superseded OR because it was cancelled, checked as
// an OR, never an AND -------------------------------------------------------

test('isStaleRequest is FALSE when cts IS the current source and has not been cancelled — the ordinary, still-active case', () => {
  const cts = fakeSource(false);
  assert.equal(isStaleRequest(cts, cts), false);
});

test('isStaleRequest is TRUE when a DIFFERENT source is now current — superseded by a newer "Start"/"Regenerate" click', () => {
  const original = fakeSource(false);
  const superseding = fakeSource(false);
  assert.equal(isStaleRequest(original, superseding), true);
});

test('isStaleRequest is TRUE when current is undefined — reset()/Clear Data cleared the field, exactly reproducing the review\'s own case ("start generation, call reset(), then resolve the old model response")', () => {
  const cts = fakeSource(false);
  assert.equal(isStaleRequest(cts, undefined), true);
});

test('isStaleRequest is TRUE when cts IS STILL the current source but has been cancelled — dispose()/cancel() without necessarily being replaced yet', () => {
  const cts = fakeSource(true);
  assert.equal(isStaleRequest(cts, cts), true);
});

test('isStaleRequest is TRUE when BOTH conditions hold (superseded AND the old one was also explicitly cancelled)', () => {
  const original = fakeSource(true);
  const superseding = fakeSource(false);
  assert.equal(isStaleRequest(original, superseding), true);
});

test('isStaleRequest treats two DIFFERENT source objects as different even if they happen to be structurally identical (reference equality, not deep equality)', () => {
  const a = fakeSource(false);
  const b = fakeSource(false); // same shape, different object
  assert.equal(isStaleRequest(a, b), true, 'a genuinely different request must never be mistaken for the same one just because their cancellation state looks the same');
});
