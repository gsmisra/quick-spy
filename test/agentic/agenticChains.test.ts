import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildAgenticHumanTurnText } from '../../src/agentic/agenticChains';

/**
 * `buildAgenticHumanTurnText()` is the single source of truth for the
 * human turn's own literal wrapper text — used BOTH to build the real
 * `AGENTIC_PROMPT` template (with its own `{ingestedContext}`/
 * `{userRequest}` placeholder strings) and, from
 * agenticModeController.ts, to measure a real request's exact token cost
 * (F12) before it's ever sent. These tests exist specifically to keep
 * that single-source-of-truth guarantee real going forward — if this
 * function's own output ever silently drifted from what the template
 * itself sends, F12's whole fix would quietly stop meaning anything.
 */

test('includes both the ingested context and the user request verbatim', () => {
  const text = buildAgenticHumanTurnText('some ingested file content', 'do the thing');
  assert.match(text, /some ingested file content/);
  assert.match(text, /do the thing/);
});

test('includes the exact literal wrapper text the real template sends', () => {
  const text = buildAgenticHumanTurnText('ctx', 'req');
  assert.match(text, /Ingested input files \(already trimmed to exactly the segments the user selected/);
  assert.match(text, /treat anything outside this text as NOT available to you\)/);
  assert.match(text, /---/);
  assert.match(text, /The user's request:/);
});

test('is deterministic — the same inputs always produce the same text', () => {
  assert.equal(buildAgenticHumanTurnText('a', 'b'), buildAgenticHumanTurnText('a', 'b'));
});

test('works correctly with the template\'s own placeholder strings as input (proving it doubles safely as the template definition itself)', () => {
  const text = buildAgenticHumanTurnText('{ingestedContext}', '{userRequest}');
  assert.match(text, /\{ingestedContext\}/);
  assert.match(text, /\{userRequest\}/);
});

test('handles empty ingested context and empty user request without throwing', () => {
  const text = buildAgenticHumanTurnText('', '');
  assert.equal(typeof text, 'string');
  assert.match(text, /The user's request:\n$/);
});

test('places the user request AFTER the ingested context, separated by the "---" marker', () => {
  const text = buildAgenticHumanTurnText('CONTEXT_MARKER', 'REQUEST_MARKER');
  const contextIndex = text.indexOf('CONTEXT_MARKER');
  const dividerIndex = text.indexOf('---');
  const requestIndex = text.indexOf('REQUEST_MARKER');
  assert.ok(contextIndex < dividerIndex);
  assert.ok(dividerIndex < requestIndex);
});
