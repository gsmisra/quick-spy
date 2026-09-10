import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { reciprocalRankFusion, DEFAULT_RRF_K, RankedList } from '../../src/rag/ragReciprocalRankFusion';

test('an item ranked first in every list gets the highest fused score', () => {
  const lists: RankedList[] = [
    { source: 'lexical', ids: ['a', 'b', 'c'] },
    { source: 'semantic', ids: ['a', 'c', 'b'] }
  ];
  const fused = reciprocalRankFusion(lists);
  assert.equal(fused[0].id, 'a');
});

test('fused score matches the hand-calculated RRF formula exactly', () => {
  const k = 60;
  const lists: RankedList[] = [
    { source: 'lexical', ids: ['a', 'b'] },
    { source: 'semantic', ids: ['b', 'a'] }
  ];
  const fused = reciprocalRankFusion(lists, k);
  const byId = new Map(fused.map((f) => [f.id, f.fusedScore]));
  // a: rank 1 lexical, rank 2 semantic -> 1/(60+1) + 1/(60+2)
  assert.ok(Math.abs(byId.get('a')! - (1 / 61 + 1 / 62)) < 1e-12);
  // b: rank 2 lexical, rank 1 semantic -> 1/(60+2) + 1/(60+1) — same total, symmetric
  assert.ok(Math.abs(byId.get('b')! - (1 / 62 + 1 / 61)) < 1e-12);
  assert.ok(Math.abs(byId.get('a')! - byId.get('b')!) < 1e-12, 'a and b should tie exactly given the symmetric ranks');
});

test('an item present in only ONE list still gets a real, positive fused score — never penalized for absence elsewhere', () => {
  const lists: RankedList[] = [
    { source: 'lexical', ids: ['a', 'b'] },
    { source: 'semantic', ids: ['c'] }
  ];
  const fused = reciprocalRankFusion(lists);
  const c = fused.find((f) => f.id === 'c')!;
  assert.ok(c.fusedScore > 0);
  assert.equal(c.contributions.length, 1);
  assert.equal(c.contributions[0].source, 'semantic');
});

test('an item present in BOTH lists scores higher than an equally-ranked item present in only one', () => {
  const lists: RankedList[] = [
    { source: 'lexical', ids: ['both', 'lexicalOnly'] },
    { source: 'semantic', ids: ['both'] }
  ];
  const fused = reciprocalRankFusion(lists);
  const byId = new Map(fused.map((f) => [f.id, f.fusedScore]));
  assert.ok(byId.get('both')! > byId.get('lexicalOnly')!);
});

test('DEFAULT_RRF_K is the standard literature default of 60', () => {
  assert.equal(DEFAULT_RRF_K, 60);
});

test('results are sorted by fused score descending', () => {
  const lists: RankedList[] = [{ source: 'lexical', ids: ['a', 'b', 'c', 'd'] }];
  const fused = reciprocalRankFusion(lists);
  for (let i = 1; i < fused.length; i++) {
    assert.ok(fused[i - 1].fusedScore >= fused[i].fusedScore);
  }
});

test('a genuine score tie is broken deterministically by id (ascending)', () => {
  // Two completely disjoint single-item lists at rank 1 each tie exactly.
  const lists: RankedList[] = [
    { source: 'a', ids: ['zebra'] },
    { source: 'b', ids: ['apple'] }
  ];
  const fused = reciprocalRankFusion(lists);
  assert.equal(fused[0].id, 'apple');
  assert.equal(fused[1].id, 'zebra');
});

test('fusion is deterministic regardless of input list order', () => {
  const listsA: RankedList[] = [
    { source: 'lexical', ids: ['a', 'b', 'c'] },
    { source: 'semantic', ids: ['c', 'a', 'b'] }
  ];
  const listsB = [...listsA].reverse();
  assert.deepEqual(reciprocalRankFusion(listsA), reciprocalRankFusion(listsB));
});

test('a duplicate id within ONE list is treated as appearing only once, at its first (best) rank', () => {
  const lists: RankedList[] = [{ source: 'lexical', ids: ['a', 'b', 'a'] }];
  const fused = reciprocalRankFusion(lists);
  const a = fused.find((f) => f.id === 'a')!;
  // Only ONE contribution recorded for 'a', at rank 1 (not rank 3 from the repeat).
  assert.equal(a.contributions.length, 1);
  assert.equal(a.contributions[0].rank, 1);
});

test('an empty list of ranked lists fuses to an empty result', () => {
  assert.deepEqual(reciprocalRankFusion([]), []);
});

test('every list being empty fuses to an empty result', () => {
  const lists: RankedList[] = [
    { source: 'lexical', ids: [] },
    { source: 'semantic', ids: [] }
  ];
  assert.deepEqual(reciprocalRankFusion(lists), []);
});

test('a larger k flattens the score gap between adjacent ranks (dampens rank-position influence)', () => {
  const lists: RankedList[] = [{ source: 'lexical', ids: ['first', 'second'] }];
  const smallK = reciprocalRankFusion(lists, 1);
  const largeK = reciprocalRankFusion(lists, 1000);
  const gapSmallK = smallK[0].fusedScore - smallK[1].fusedScore;
  const gapLargeK = largeK[0].fusedScore - largeK[1].fusedScore;
  assert.ok(gapLargeK < gapSmallK, 'a larger k should shrink the score gap between rank 1 and rank 2');
});

test('contributions record every source list an id actually appeared in, with its own rank in each', () => {
  const lists: RankedList[] = [
    { source: 'lexical', ids: ['shared'] },
    { source: 'semantic', ids: ['other', 'shared'] }
  ];
  const fused = reciprocalRankFusion(lists);
  const shared = fused.find((f) => f.id === 'shared')!;
  assert.deepEqual(
    shared.contributions.sort((a, b) => a.source.localeCompare(b.source)),
    [
      { source: 'lexical', rank: 1 },
      { source: 'semantic', rank: 2 }
    ]
  );
});
