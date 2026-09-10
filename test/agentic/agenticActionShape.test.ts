import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildAgenticActionShape } from '../../src/agentic/agenticActionShape';

// --- A14: the shape returned here must be the EXACT SAME structure the
// caller measures AND sends — no directive/fallback text may be added
// later, after measurement, that this function doesn't already account for.

test('A14: "feature" includes a non-empty directiveSuffix and does NOT request the CSV template', () => {
  const shape = buildAgenticActionShape('feature', 'do the thing', 'java', '11');
  assert.ok(shape.directiveSuffix.length > 0);
  assert.match(shape.directiveSuffix, /Cucumber Gherkin/);
  assert.equal(shape.includeCsvTemplate, false);
});

test('A14: "code" includes a non-empty directiveSuffix naming the TARGET language/version, and does NOT request the CSV template', () => {
  const shape = buildAgenticActionShape('code', 'do the thing', 'python', '3.11');
  assert.ok(shape.directiveSuffix.length > 0);
  assert.match(shape.directiveSuffix, /python \(version 3\.11\)/);
  assert.equal(shape.includeCsvTemplate, false);
});

test('A14: "csv" has NO directiveSuffix at all (nothing is appended after its systemInstructions), and DOES request the CSV template', () => {
  const shape = buildAgenticActionShape('csv', 'do the thing', 'java', '11');
  assert.equal(shape.directiveSuffix, '');
  assert.equal(shape.includeCsvTemplate, true);
});

test('A14: a NON-EMPTY lastUserRequest is used VERBATIM as the effective request, for every action', () => {
  for (const kind of ['feature', 'code', 'csv'] as const) {
    const shape = buildAgenticActionShape(kind, 'a real, specific ask', 'java', '11');
    assert.equal(shape.effectiveUserRequest, 'a real, specific ask');
  }
});

test('A14: an EMPTY lastUserRequest falls back to a non-empty, action-specific placeholder — never an empty string reaching the chain', () => {
  for (const kind of ['feature', 'code', 'csv'] as const) {
    const shape = buildAgenticActionShape(kind, '', 'java', '11');
    assert.ok(shape.effectiveUserRequest.length > 0, `${kind}'s effectiveUserRequest must never be empty`);
  }
});

test('A14: feature and code share the IDENTICAL fallback placeholder text (both reference "ingested files and any custom instructions/RAG context")', () => {
  const feature = buildAgenticActionShape('feature', '', 'java', '11');
  const code = buildAgenticActionShape('code', '', 'java', '11');
  assert.equal(feature.effectiveUserRequest, code.effectiveUserRequest);
  assert.match(feature.effectiveUserRequest, /ingested files/);
});

test('A14: csv has its OWN, distinctly-worded fallback placeholder, different from feature/code\'s', () => {
  const csv = buildAgenticActionShape('csv', '', 'java', '11');
  const feature = buildAgenticActionShape('feature', '', 'java', '11');
  assert.notEqual(csv.effectiveUserRequest, feature.effectiveUserRequest);
  assert.match(csv.effectiveUserRequest, /every scenario/);
});

test('A14: whitespace-only lastUserRequest is treated as non-empty (preserved verbatim) — only a GENUINELY empty string triggers the fallback, matching `||`\'s own falsy-string semantics used throughout this codebase', () => {
  // Documents the exact, intentional semantics (a plain `||` check, same as
  // the rest of agenticModeController.ts already used before this fix) —
  // not a new behavior introduced by this refactor.
  const shape = buildAgenticActionShape('feature', '   ', 'java', '11');
  assert.equal(shape.effectiveUserRequest, '   ');
});

test('A14: the SAME inputs always produce the SAME shape — no hidden non-determinism (e.g. from Date/Math.random)', () => {
  const a = buildAgenticActionShape('code', 'ask', 'java', '17');
  const b = buildAgenticActionShape('code', 'ask', 'java', '17');
  assert.deepEqual(a, b);
});
