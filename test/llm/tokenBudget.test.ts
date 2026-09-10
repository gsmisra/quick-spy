import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { decideTokenBudget, PromptTooLargeError, PROMPT_TOKEN_SAFETY_MARGIN } from '../../src/llm/tokenBudget';

test('fits comfortably under budget', () => {
  const decision = decideTokenBudget([100, 200], 10_000);
  assert.equal(decision.outcome, 'fits');
  assert.equal(decision.totalTokens, 300);
  assert.equal(decision.maxInputTokens, 10_000);
  assert.equal(decision.budget, Math.floor(10_000 * PROMPT_TOKEN_SAFETY_MARGIN));
});

test('a fake SMALL-CONTEXT model correctly rejects a request that would fit a normal model', () => {
  // Same 300-token request as the test above, but against a model whose
  // own context window is tiny — must now exceed.
  const decision = decideTokenBudget([100, 200], 250);
  assert.equal(decision.outcome, 'exceeds');
  assert.equal(decision.totalTokens, 300);
});

test('EXACT boundary: total exactly AT the safety-margined budget still fits', () => {
  const maxInputTokens = 1_000;
  const budget = Math.floor(maxInputTokens * PROMPT_TOKEN_SAFETY_MARGIN); // 900
  const decision = decideTokenBudget([budget], maxInputTokens);
  assert.equal(decision.outcome, 'fits');
  assert.equal(decision.totalTokens, budget);
});

test('EXACT boundary: one token over the safety-margined budget exceeds', () => {
  const maxInputTokens = 1_000;
  const budget = Math.floor(maxInputTokens * PROMPT_TOKEN_SAFETY_MARGIN); // 900
  const decision = decideTokenBudget([budget + 1], maxInputTokens);
  assert.equal(decision.outcome, 'exceeds');
});

test('an OVERSIZED source (a single very large message) is caught on its own, no other messages needed', () => {
  const decision = decideTokenBudget([500_000], 128_000);
  assert.equal(decision.outcome, 'exceeds');
  assert.equal(decision.totalTokens, 500_000);
});

test('OVERSIZED custom instructions combine with other messages to exceed budget even when each is individually small', () => {
  // e.g. built-in instructions + several checked custom .md files + a RAG
  // section + reference code, each modest alone, summing over budget.
  const perMessage = [2_000, 3_000, 4_000, 5_000, 6_000]; // sums to 20,000
  const decision = decideTokenBudget(perMessage, 20_000); // budget = 18,000
  assert.equal(decision.outcome, 'exceeds');
  assert.equal(decision.totalTokens, 20_000);
});

test('UNAVAILABLE token counting for even one message makes the whole decision "unmeasured", not a false pass', () => {
  const decision = decideTokenBudget([100, undefined, 200], 10_000);
  assert.equal(decision.outcome, 'unmeasured');
  assert.equal(decision.totalTokens, undefined);
});

test('UNAVAILABLE token counting never gets reported as "exceeds" just because other messages summed high', () => {
  const decision = decideTokenBudget([50_000, undefined], 10_000);
  assert.equal(decision.outcome, 'unmeasured');
});

test('a completely empty message list fits trivially (zero tokens)', () => {
  const decision = decideTokenBudget([], 1_000);
  assert.equal(decision.outcome, 'fits');
  assert.equal(decision.totalTokens, 0);
});

test('PromptTooLargeError message names the concrete numbers and actionable levers', () => {
  const err = new PromptTooLargeError(12_345, 8_000, 7_200);
  assert.match(err.message, /12,345/);
  assert.match(err.message, /7,200/);
  assert.match(err.message, /8,000/);
  assert.match(err.message, /Custom Instruction/i);
  assert.match(err.message, /RAG/i);
  assert.match(err.message, /larger context window/i);
  assert.equal(err.name, 'PromptTooLargeError');
  assert.ok(err instanceof Error);
});

test('a custom (non-default) safety margin is respected', () => {
  const decision = decideTokenBudget([500], 1_000, 0.5); // budget = 500
  assert.equal(decision.outcome, 'fits'); // exactly at budget
  const decisionOver = decideTokenBudget([501], 1_000, 0.5);
  assert.equal(decisionOver.outcome, 'exceeds');
});
