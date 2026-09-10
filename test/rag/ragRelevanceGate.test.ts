import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { applyRelevanceGate, hasSymbolEvidence, DEFAULT_RELEVANCE_GATE, RelevanceGateConfig, GateCandidate } from '../../src/rag/ragRelevanceGate';
import type { RagMatch } from '../../src/rag/ragRetriever';

function makeMatch(id: string, score: number): RagMatch {
  return { id, title: `Title for ${id}`, body: 'body', score, filePath: `/fake/.github/rag/${id}.md` };
}

function candidate(id: string, score: number, modeMatches = true): GateCandidate {
  return { match: makeMatch(id, score), score, modeMatches };
}

// --- hasSymbolEvidence -------------------------------------------------------

test('finds a symbol token from a multi-word id in the query text', () => {
  assert.equal(hasSymbolEvidence('use PostgresHelper to query one row', 'postgres-query-and-validate'), true);
});

test('returns false when no id token appears anywhere in the query', () => {
  assert.equal(hasSymbolEvidence('take a screenshot of the page', 'postgres-query-and-validate'), false);
});

test('is case-insensitive', () => {
  assert.equal(hasSymbolEvidence('CASSANDRA table lookup', 'cassandra-connection-helper'), true);
});

test('ignores short (< 4 char) id tokens as too generic to count as evidence', () => {
  // "a", "id" (2 chars), and "and" (a common connector, 3 chars) inside a
  // hypothetical id should never trigger a match on their own.
  assert.equal(hasSymbolEvidence('an id value here and more text', 'a-id-and-x'), false);
});

// --- applyRelevanceGate: DEFAULT config reproduces today's exact behavior ---

test('DEFAULT_RELEVANCE_GATE accepts any candidate with a positive score, regardless of query text', () => {
  const decisions = applyRelevanceGate([candidate('a', 0.001)], 'completely unrelated text', DEFAULT_RELEVANCE_GATE);
  assert.equal(decisions[0].accepted, true);
  assert.deepEqual(decisions[0].reasons, []);
});

test('DEFAULT_RELEVANCE_GATE rejects a non-positive score — this floor is never disabled', () => {
  const decisions = applyRelevanceGate([candidate('a', 0), candidate('b', -0.1)], 'anything', DEFAULT_RELEVANCE_GATE);
  assert.equal(decisions[0].accepted, false);
  assert.equal(decisions[1].accepted, false);
});

// --- minLexicalScore ---------------------------------------------------------

test('minLexicalScore rejects a candidate below the configured floor, with an explicit reason', () => {
  const config: RelevanceGateConfig = { ...DEFAULT_RELEVANCE_GATE, minLexicalScore: 0.1 };
  const decisions = applyRelevanceGate([candidate('weak', 0.05), candidate('strong', 0.5)], 'anything', config);
  assert.equal(decisions[0].accepted, false);
  assert.match(decisions[0].reasons[0], /below the configured minimum lexical score/);
  assert.equal(decisions[1].accepted, true);
});

// --- requireSymbolEvidence ---------------------------------------------------

test('requireSymbolEvidence rejects a positively-scored candidate with no symbol evidence in the query', () => {
  const config: RelevanceGateConfig = { ...DEFAULT_RELEVANCE_GATE, requireSymbolEvidence: true };
  const decisions = applyRelevanceGate([candidate('postgres-helper', 0.9)], 'take a screenshot', config);
  assert.equal(decisions[0].accepted, false);
  assert.match(decisions[0].reasons[0], /no explicit symbol evidence/);
});

test('requireSymbolEvidence accepts a candidate whose id is echoed in the query text', () => {
  const config: RelevanceGateConfig = { ...DEFAULT_RELEVANCE_GATE, requireSymbolEvidence: true };
  const decisions = applyRelevanceGate([candidate('postgres-helper', 0.9)], 'use postgres to fetch data', config);
  assert.equal(decisions[0].accepted, true);
});

// --- requireModeCompatibility -------------------------------------------------

test('requireModeCompatibility rejects a mode-mismatched candidate even with a strong score', () => {
  const config: RelevanceGateConfig = { ...DEFAULT_RELEVANCE_GATE, requireModeCompatibility: true };
  const decisions = applyRelevanceGate([candidate('a', 0.9, false)], 'anything', config);
  assert.equal(decisions[0].accepted, false);
  assert.match(decisions[0].reasons[0], /automationMode does not match/);
});

test('requireModeCompatibility accepts a mode-matched candidate', () => {
  const config: RelevanceGateConfig = { ...DEFAULT_RELEVANCE_GATE, requireModeCompatibility: true };
  const decisions = applyRelevanceGate([candidate('a', 0.9, true)], 'anything', config);
  assert.equal(decisions[0].accepted, true);
});

// --- combined configuration + multiple reasons -------------------------------

test('a candidate can fail MULTIPLE checks at once, each reported separately', () => {
  const config: RelevanceGateConfig = { minLexicalScore: 0.5, requireSymbolEvidence: true, requireModeCompatibility: true };
  const decisions = applyRelevanceGate([candidate('postgres-helper', 0.1, false)], 'take a screenshot', config);
  assert.equal(decisions[0].accepted, false);
  assert.equal(decisions[0].reasons.length, 3);
});

test('every check must pass for acceptance under a fully-configured gate', () => {
  const config: RelevanceGateConfig = { minLexicalScore: 0.5, requireSymbolEvidence: true, requireModeCompatibility: true };
  const decisions = applyRelevanceGate([candidate('postgres-helper', 0.9, true)], 'use postgres to fetch a row', config);
  assert.equal(decisions[0].accepted, true);
  assert.deepEqual(decisions[0].reasons, []);
});

test('an empty candidate list returns an empty decision list', () => {
  assert.deepEqual(applyRelevanceGate([], 'anything', DEFAULT_RELEVANCE_GATE), []);
});
