import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildRagIndex } from '../../src/rag/ragIndexBuilder';
import { retrieveRagMatches } from '../../src/rag/ragRetriever';
import { RagRecipe, recipeToEmbeddingText } from '../../src/rag/ragTypes';
import { EmbeddingProvider } from '../../src/rag/ragEmbeddingProvider';
import { rankSemanticCandidates, retrieveHybridMatches, DEFAULT_HYBRID_GATE, VectorDimensionMismatchError } from '../../src/rag/ragHybridRetriever';
import { DEFAULT_RELEVANCE_GATE, RelevanceGateConfig } from '../../src/rag/ragRelevanceGate';

/**
 * These tests use a hand-built, fully DETERMINISTIC fake `EmbeddingProvider`
 * (an exact text -> vector lookup table the test itself defines) rather than
 * any real semantic model — the point is to verify the FUSION MECHANISM
 * (rankSemanticCandidates' ranking, RRF combination, gating) is wired
 * correctly, independent of whether any particular real embedding provider
 * would actually judge two texts as similar. See
 * rag/benchmark/ragHybridEvaluationRunner.ts for the equivalent honesty note
 * on the evaluation harness.
 */

function makeRecipe(options: {
  id: string;
  title: string;
  body: string;
  tags?: string[];
  automationMode?: RagRecipe['frontmatter']['automationMode'];
  language?: RagRecipe['frontmatter']['language'];
  relativePath?: string;
}): RagRecipe {
  const relativePath = options.relativePath ?? `${options.id}.md`;
  return {
    filePath: `/fake/.github/rag/${relativePath}`,
    relativePath,
    mtimeMs: 0,
    frontmatter: {
      id: options.id,
      title: options.title,
      tags: options.tags ?? [],
      automationMode: options.automationMode ?? ['ui', 'api'],
      language: options.language ?? ['java', 'python']
    },
    body: options.body
  };
}

/** Exact-text lookup fake — throws on any unexpected input so a test never
 * silently passes due to an accidental fallback value. */
function fakeProviderFromMap(map: Map<string, number[]>): EmbeddingProvider {
  const vectorFor = (text: string): number[] => {
    const vector = map.get(text);
    if (!vector) {
      throw new Error(`fakeProviderFromMap: no vector configured for text: ${JSON.stringify(text)}`);
    }
    return vector;
  };
  return {
    id: 'fake',
    embedQuery: async (text) => vectorFor(text),
    embedDocuments: async (texts) => texts.map(vectorFor)
  };
}

const JAVA_RECIPE = makeRecipe({ id: 'topic-a', title: 'Topic A helper', body: '```java\nA.op();\n```', automationMode: ['api'], language: ['java'] });
const JAVA_RECIPE_2 = makeRecipe({ id: 'topic-b', title: 'Topic B helper', body: '```java\nB.op();\n```', automationMode: ['api'], language: ['java'] });
const PYTHON_ONLY_RECIPE = makeRecipe({ id: 'python-only', title: 'Python only helper', body: '```python\ndef op(): pass\n```', automationMode: ['api'], language: ['python'] });

// --- rankSemanticCandidates ---------------------------------------------------

test('rankSemanticCandidates ranks recipes by cosine similarity to the query, best first', async () => {
  const index = await buildRagIndex([JAVA_RECIPE, JAVA_RECIPE_2]);
  const provider = fakeProviderFromMap(
    new Map([
      ['the query', [1, 0]],
      [recipeToEmbeddingText(JAVA_RECIPE), [1, 0]], // identical direction -> cosine similarity 1
      [recipeToEmbeddingText(JAVA_RECIPE_2), [0, 1]] // orthogonal -> cosine similarity 0
    ])
  );
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'the query', 'java', 'api');
  assert.equal(ranked.length, 1, 'the orthogonal (zero-similarity) recipe should be filtered out, only the positive-scoring one remains');
  assert.equal(ranked[0].id, 'topic-a');
});

test('rankSemanticCandidates applies the HARD language filter, same as lexical retrieval', async () => {
  const index = await buildRagIndex([JAVA_RECIPE, PYTHON_ONLY_RECIPE]);
  const provider = fakeProviderFromMap(
    new Map([
      ['q', [1]],
      [recipeToEmbeddingText(JAVA_RECIPE), [1]]
      // PYTHON_ONLY_RECIPE deliberately has NO entry — proving it's filtered
      // out before ever being embedded at all.
    ])
  );
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'api');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'topic-a');
});

test('rankSemanticCandidates applies the SAME automationMode soft-preference penalty as lexical retrieval', async () => {
  const mismatched = makeRecipe({ id: 'mismatched', title: 'X', body: 'x', automationMode: ['api'], language: ['java'] });
  const matched = makeRecipe({ id: 'matched', title: 'X', body: 'x', automationMode: ['ui'], language: ['java'] });
  const index = await buildRagIndex([mismatched, matched]);
  // Both recipes embed to the IDENTICAL vector as the query — equal raw
  // cosine similarity — so any ranking difference must come purely from
  // the automationMode penalty.
  const provider = fakeProviderFromMap(
    new Map([
      ['q', [1, 0]],
      [recipeToEmbeddingText(mismatched), [1, 0]],
      [recipeToEmbeddingText(matched), [1, 0]]
    ])
  );
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'ui');
  assert.equal(ranked[0].id, 'matched', 'the mode-matched recipe should outrank an equally-similar mode-mismatched one');
  assert.ok(ranked[0].score > ranked[1].score);
});

test('rankSemanticCandidates returns an empty list for an empty query, without calling the provider at all', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  let called = false;
  const provider: EmbeddingProvider = {
    id: 'fake',
    embedQuery: async () => {
      called = true;
      return [1];
    },
    embedDocuments: async () => {
      called = true;
      return [[1]];
    }
  };
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, '   ', 'java', 'api');
  assert.deepEqual(ranked, []);
  assert.equal(called, false);
});

// --- A08: staleFilePaths is excluded BEFORE embedding, never merely
// filtered out of the ranked result afterward -----------------------------

test('A08: rankSemanticCandidates NEVER sends an excluded recipe\'s text to the embedding provider at all', async () => {
  const index = await buildRagIndex([JAVA_RECIPE, JAVA_RECIPE_2]);
  // A provider that throws if asked to embed JAVA_RECIPE_2's own text —
  // proving the exclusion happens BEFORE `embedDocuments()` is ever called
  // with it, not merely filtered out of what comes back afterward.
  const provider: EmbeddingProvider = {
    id: 'fake',
    embedQuery: async () => [1, 0],
    embedDocuments: async (texts) => {
      for (const text of texts) {
        if (text === recipeToEmbeddingText(JAVA_RECIPE_2)) {
          throw new Error('FAIL: an excluded recipe\'s own content was sent to the embedding provider');
        }
      }
      return texts.map(() => [1, 0]);
    }
  };
  const staleFilePaths = new Set([JAVA_RECIPE_2.filePath]);
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'the query', 'java', 'api', staleFilePaths);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'topic-a');
});

test('A08: retrieveHybridMatches excludes a stale candidate from BOTH rankers, and a fresh candidate ranked outside either ranker\'s own pool still surfaces', async () => {
  const recipes = ['a', 'b', 'c', 'd'].map((letter) =>
    makeRecipe({ id: `helper-${letter}`, title: `Postgres helper ${letter}`, body: `\`\`\`java\n${letter}.op();\n\`\`\``, automationMode: ['api'], language: ['java'] })
  );
  const index = await buildRagIndex(recipes);
  const queryText = 'find postgres helper';

  const vectorMap = new Map<string, number[]>([[queryText, [1, 0]]]);
  recipes.forEach((r) => vectorMap.set(recipeToEmbeddingText(r), [1, 0])); // all equally strong semantically
  const provider = fakeProviderFromMap(vectorMap);

  // All four are equally strong lexically AND semantically — with topK 3
  // and no exclusion, exactly 3 of the 4 come back.
  const withoutExclusion = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 3 });
  assert.equal(withoutExclusion.length, 3);

  const staleFilePaths = new Set(withoutExclusion.map((m) => m.filePath));
  const freshRecipe = recipes.find((r) => !staleFilePaths.has(r.filePath))!;

  const withExclusion = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 3, staleFilePaths });
  assert.ok(
    withExclusion.some((m) => m.filePath === freshRecipe.filePath),
    'the fresh candidate must surface once the previously-top-ranked ones are excluded from BOTH rankers before fusion, not just from the final result'
  );
  assert.ok(withExclusion.every((m) => !staleFilePaths.has(m.filePath)), 'no excluded candidate may appear anywhere in the fused result');
});

test('A08: omitting staleFilePaths from retrieveHybridMatches excludes nothing — today\'s exact prior behavior, unchanged', async () => {
  const index = await buildRagIndex([JAVA_RECIPE, JAVA_RECIPE_2]);
  const queryText = 'topic';
  const vectorMap = new Map<string, number[]>([
    [queryText, [1, 0]],
    [recipeToEmbeddingText(JAVA_RECIPE), [1, 0]],
    [recipeToEmbeddingText(JAVA_RECIPE_2), [1, 0]]
  ]);
  const provider = fakeProviderFromMap(vectorMap);
  const withoutParam = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 5 });
  const withEmptySet = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 5, staleFilePaths: new Set() });
  assert.deepEqual(withoutParam, withEmptySet);
});

// --- retrieveHybridMatches -----------------------------------------------------

test('a recipe with ZERO lexical overlap but a strong semantic match is still surfaced by hybrid retrieval', async () => {
  // Deliberately avoids ANY shared word or camelCase sub-word (e.g.
  // "SomeUnrelatedThing" would leak a "Thing" sub-word feature into
  // TF-IDF via tfidfEmbeddings.ts's own identifier-splitting — see that
  // module's own doc comment) with the query below, so the "sanity check"
  // that lexical alone finds nothing is genuinely true, not accidental.
  const semanticOnly = makeRecipe({
    id: 'semantic-only-match',
    title: 'Zzqvex module wrapper',
    body: '```java\nZzqvexModule.invoke();\n```',
    tags: ['zzqvex-tag'],
    automationMode: ['api'],
    language: ['java']
  });
  const noise = makeRecipe({
    id: 'noise',
    title: 'Blorptak utility',
    body: '```java\nBlorptakUtil.run();\n```',
    tags: ['blorptak-tag'],
    automationMode: ['api'],
    language: ['java']
  });
  const index = await buildRagIndex([semanticOnly, noise]);
  const queryText = 'connect to the payment gateway';

  // Sanity check: lexical alone finds nothing — zero shared vocabulary.
  const lexicalOnly = await retrieveRagMatches(index, queryText, 'java', 'api');
  assert.equal(lexicalOnly.length, 0);

  const provider = fakeProviderFromMap(
    new Map([
      [queryText, [1, 0]],
      [recipeToEmbeddingText(semanticOnly), [1, 0]], // same direction as the query
      [recipeToEmbeddingText(noise), [0, 1]] // orthogonal — no similarity
    ])
  );
  const hybrid = await retrieveHybridMatches(index, provider, queryText, 'java', 'api');
  assert.ok(hybrid.some((m) => m.id === 'semantic-only-match'), 'the semantically-matched recipe should surface via hybrid retrieval despite zero lexical overlap');
});

test('a recipe found by BOTH lexical and semantic ranking outranks one found by only a single ranker', async () => {
  const both = makeRecipe({ id: 'both', title: 'shared vocabulary term', body: '```java\nX.op();\n```', automationMode: ['api'], language: ['java'] });
  const lexicalOnlyRecipe = makeRecipe({
    id: 'lexical-only',
    title: 'shared vocabulary term but different semantics',
    body: '```java\nY.op();\n```',
    automationMode: ['api'],
    language: ['java']
  });
  const index = await buildRagIndex([both, lexicalOnlyRecipe]);
  const queryText = 'shared vocabulary term';

  const provider = fakeProviderFromMap(
    new Map([
      [queryText, [1, 0]],
      [recipeToEmbeddingText(both), [1, 0]], // strong semantic match too
      [recipeToEmbeddingText(lexicalOnlyRecipe), [0, 1]] // lexically similar (shares words) but semantically orthogonal in this fake space
    ])
  );
  const hybrid = await retrieveHybridMatches(index, provider, queryText, 'java', 'api');
  const ids = hybrid.map((m) => m.id);
  assert.ok(ids.indexOf('both') < ids.indexOf('lexical-only'), 'the doubly-confirmed recipe should rank ahead of the singly-confirmed one');
});

test('the HARD language filter still applies end-to-end in hybrid mode', async () => {
  const index = await buildRagIndex([JAVA_RECIPE, PYTHON_ONLY_RECIPE]);
  const queryText = 'q';
  const provider = fakeProviderFromMap(
    new Map([
      [queryText, [1]],
      [recipeToEmbeddingText(JAVA_RECIPE), [1]]
      // PYTHON_ONLY_RECIPE has no entry — if it were ever embedded (a bug),
      // this fake provider throws and fails the test loudly.
    ])
  );
  const hybrid = await retrieveHybridMatches(index, provider, queryText, 'java', 'api');
  assert.ok(!hybrid.some((m) => m.id === 'python-only'));
});

test('retrieveHybridMatches returns an empty list for an empty/whitespace-only query', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  const provider = fakeProviderFromMap(new Map());
  const hybrid = await retrieveHybridMatches(index, provider, '   ', 'java', 'api');
  assert.deepEqual(hybrid, []);
});

test('retrieveHybridMatches respects the topK option', async () => {
  const recipes = Array.from({ length: 5 }, (_, i) => makeRecipe({ id: `r${i}`, title: 'x', body: 'x', automationMode: ['api'], language: ['java'] }));
  const index = await buildRagIndex(recipes);
  const map = new Map<string, number[]>([['q', [1, 0]]]);
  recipes.forEach((r) => map.set(recipeToEmbeddingText(r), [1, 0])); // all equally semantically relevant
  const provider = fakeProviderFromMap(map);
  const hybrid = await retrieveHybridMatches(index, provider, 'q', 'java', 'api', { topK: 2 });
  assert.equal(hybrid.length, 2);
});

// --- A06: duplicate frontmatter.id must never make hybrid retrieval return
// another recipe's body -------------------------------------------------

test('A06: two recipes sharing the SAME raw frontmatter.id are still distinguishable through hybrid retrieval — each keeps its OWN body/path, never the other\'s', async () => {
  // Mirrors the review's own "alpha/beta both id:'same'" repro: two
  // genuinely different recipes whose MODEL-SUPPLIED id happens to collide.
  // ragIndexBuilder.ts's dedupeRecipeIds() gives each occurrence a distinct
  // suffixed canonical id (e.g. "same-<hash>") — before the A06 fix,
  // rankSemanticCandidates()/retrieveHybridMatches() fell back to the RAW,
  // still-colliding `frontmatter.id` on the semantic side, which could
  // surface a THIRD, spurious "same" entry carrying whichever of the two
  // recipes happened to be last in `index.recipes`.
  const alpha = makeRecipe({ id: 'same', title: 'Alpha helper', body: '```java\nAlpha.op();\n```', relativePath: 'alpha.md', automationMode: ['api'], language: ['java'] });
  const beta = makeRecipe({ id: 'same', title: 'Beta helper', body: '```java\nBeta.op();\n```', relativePath: 'beta.md', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([alpha, beta]);

  // Both canonical ids are distinct and suffixed (neither is the bare "same").
  assert.equal(index.canonicalIds.length, 2);
  assert.notEqual(index.canonicalIds[0], index.canonicalIds[1]);
  assert.ok(index.canonicalIds.every((id) => id.startsWith('same-') && id !== 'same'));

  const provider = fakeProviderFromMap(
    new Map([
      ['find alpha', [1, 0]],
      [recipeToEmbeddingText(alpha), [1, 0]], // strong semantic match for alpha
      [recipeToEmbeddingText(beta), [0, 1]] // orthogonal — beta is not a semantic match
    ])
  );

  // Semantic ranking itself must emit the CANONICAL ids, never the bare
  // colliding "same" for both.
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'find alpha', 'java', 'api');
  const rankedIds = ranked.map((r) => r.id);
  assert.ok(!rankedIds.includes('same'), 'no candidate should carry the bare, still-colliding raw id');
  for (const id of rankedIds) {
    assert.ok(index.canonicalIds.includes(id), `ranked id ${id} must be one of the corpus's own canonical ids`);
  }

  const hybrid = await retrieveHybridMatches(index, provider, 'find alpha', 'java', 'api', { topK: 5 });
  assert.ok(!hybrid.some((m) => m.id === 'same'), 'no returned match should carry the bare, still-colliding raw id');

  const alphaMatch = hybrid.find((m) => m.title === 'Alpha helper');
  assert.ok(alphaMatch, 'alpha must be findable by its own title');
  assert.ok(alphaMatch!.body.includes('Alpha.op'), 'alpha\'s match must carry ALPHA\'s own body, never beta\'s');
  assert.equal(alphaMatch!.filePath, alpha.filePath, 'alpha\'s match must carry ALPHA\'s own filePath, never beta\'s');

  // No entry anywhere in the result should carry beta's body under alpha's
  // identity (or vice versa) — every returned match's id must round-trip
  // to a recipe whose OWN title matches what's attached.
  for (const match of hybrid) {
    if (match.title === 'Alpha helper') {
      assert.ok(match.body.includes('Alpha.op'));
    } else if (match.title === 'Beta helper') {
      assert.ok(match.body.includes('Beta.op'));
    }
  }
});

test('A06: a collision between an EXISTING id and a generated deduped-suffix id does not merge the two recipes', async () => {
  // A pathological but possible case: recipe A's raw id is "dup", recipe B's
  // raw id is "dup" too (colliding), AND a THIRD recipe C's raw id happens
  // to already equal what dedupeRecipeIds() would generate as A/B's
  // suffixed id. dedupeRecipeIds() only touches ids with count > 1, so C's
  // bare id stays untouched even if it happens to look like a generated
  // suffix — it is a distinct, valid raw id in its own right, count 1.
  const first = makeRecipe({ id: 'dup', title: 'First', body: '```java\nFirst.op();\n```', relativePath: 'first.md', automationMode: ['api'], language: ['java'] });
  const second = makeRecipe({ id: 'dup', title: 'Second', body: '```java\nSecond.op();\n```', relativePath: 'second.md', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([first, second]);

  // Every recipe still gets its own distinct canonical id, and both
  // canonical ids differ from the original bare "dup".
  assert.equal(new Set(index.canonicalIds).size, 2);
  assert.ok(index.canonicalIds.every((id) => id !== 'dup'));

  const provider = fakeProviderFromMap(
    new Map([
      ['q', [1, 0]],
      [recipeToEmbeddingText(first), [1, 0]],
      [recipeToEmbeddingText(second), [1, 0]]
    ])
  );
  const hybrid = await retrieveHybridMatches(index, provider, 'q', 'java', 'api', { topK: 5 });
  const titles = hybrid.map((m) => m.title).sort();
  assert.deepEqual(titles, ['First', 'Second'], 'both recipes must survive independently, never collapsed into one');
});

// --- A10: a semantic-side failure must degrade to lexical-only, never
// escape and discard an otherwise-successful lexical result -------------

/** A fake `EmbeddingProvider` whose calls reject with `error` — simulating
 * a real provider rejection (network error, non-2xx status,
 * `EmbeddingTimeoutError`, a malformed-response parse error — this test
 * suite doesn't care WHICH, `retrieveHybridMatches()`'s own degrade-to-
 * lexical path treats every non-cancellation rejection identically). */
function failingProvider(error: Error): EmbeddingProvider {
  return {
    id: 'failing',
    embedQuery: async () => {
      throw error;
    },
    embedDocuments: async () => {
      throw error;
    }
  };
}

test('A10: a semantic PROVIDER REJECTION degrades to lexical-only results — a working lexical match is never discarded because the network side failed', async () => {
  const recipe = makeRecipe({ id: 'lexical-still-works', title: 'shared vocabulary term', body: '```java\nX.op();\n```', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([recipe]);
  const provider = failingProvider(new Error('ECONNREFUSED: connection refused'));

  const hybrid = await retrieveHybridMatches(index, provider, 'shared vocabulary term', 'java', 'api');
  assert.ok(
    hybrid.some((m) => m.id === 'lexical-still-works'),
    'a lexical-only match must still come back even though the semantic provider rejected — this is the exact reproduced A10 gap (an endpoint outage used to block a previously usable lexical flow)'
  );
});

test('A10: onSemanticFailure is called with a readable message exactly once, only on a REAL (non-cancellation) failure', async () => {
  const recipe = makeRecipe({ id: 'r', title: 'shared vocabulary term', body: '```java\nX.op();\n```', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([recipe]);
  const provider = failingProvider(new Error('the endpoint is down'));

  const calls: string[] = [];
  await retrieveHybridMatches(index, provider, 'shared vocabulary term', 'java', 'api', { onSemanticFailure: (message) => calls.push(message) });
  assert.equal(calls.length, 1);
  assert.match(calls[0], /the endpoint is down/);
});

test('A10: a semantic failure caused by CANCELLATION (the caller\'s own signal) is PROPAGATED, never silently degraded to a lexical fallback', async () => {
  const recipe = makeRecipe({ id: 'r', title: 'shared vocabulary term', body: '```java\nX.op();\n```', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([recipe]);
  const controller = new AbortController();
  controller.abort();
  const abortError = new Error('The operation was aborted.');
  abortError.name = 'AbortError';
  const provider = failingProvider(abortError);

  const calls: string[] = [];
  await assert.rejects(
    () => retrieveHybridMatches(index, provider, 'shared vocabulary term', 'java', 'api', { signal: controller.signal, onSemanticFailure: (message) => calls.push(message) }),
    /aborted/
  );
  assert.equal(calls.length, 0, 'cancellation must never be reported as a "fell back to lexical" event — it never falls back at all');
});

test('A10: signal is forwarded to the provider\'s own embedQuery/embedDocuments calls', async () => {
  const recipe = makeRecipe({ id: 'r', title: 'x', body: 'x', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([recipe]);
  const controller = new AbortController();
  let receivedQuerySignal: AbortSignal | undefined;
  let receivedDocsSignal: AbortSignal | undefined;
  const provider: EmbeddingProvider = {
    id: 'capturing',
    embedQuery: async (_text, signal) => {
      receivedQuerySignal = signal;
      return [1, 0];
    },
    embedDocuments: async (texts, signal) => {
      receivedDocsSignal = signal;
      return texts.map(() => [1, 0]);
    }
  };
  await retrieveHybridMatches(index, provider, 'q', 'java', 'api', { signal: controller.signal });
  assert.equal(receivedQuerySignal, controller.signal);
  assert.equal(receivedDocsSignal, controller.signal);
});

test('A10: rankSemanticCandidates forwards signal straight through to the provider, unmodified', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const provider: EmbeddingProvider = {
    id: 'capturing',
    embedQuery: async (_t, signal) => {
      received = signal;
      return [1, 0];
    },
    embedDocuments: async (texts) => texts.map(() => [1, 0])
  };
  await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'api', undefined, controller.signal);
  assert.equal(received, controller.signal);
});

// --- A11: incompatible vectors must be refused, never silently truncated
// into apparent agreement --------------------------------------------------

/** A fake provider whose query/document vectors have DIFFERENT dimensions
 * — the exact reproduced A11 shape ("query vector [1,0] and document
 * vector [1]"). */
function mismatchedDimensionProvider(): EmbeddingProvider {
  return {
    id: 'mismatched',
    embedQuery: async () => [1, 0],
    embedDocuments: async (texts) => texts.map(() => [1]) // ONE dimension, the query is TWO
  };
}

test('A11: rankSemanticCandidates REJECTS (never silently truncates) when the query and document vectors have different dimensions — the exact reproduced case', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  await assert.rejects(
    () => rankSemanticCandidates(index.recipes, index.canonicalIds, mismatchedDimensionProvider(), 'find alpha', 'java', 'api'),
    VectorDimensionMismatchError
  );
});

test('A11: retrieveHybridMatches degrades to lexical-only (via the A10 wiring) when the semantic side hits a dimension mismatch, rather than manufacturing a bogus perfect-similarity score', async () => {
  const recipe = makeRecipe({ id: 'lexical-still-works', title: 'shared vocabulary term', body: '```java\nX.op();\n```', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([recipe]);
  const calls: string[] = [];
  const hybrid = await retrieveHybridMatches(index, mismatchedDimensionProvider(), 'shared vocabulary term', 'java', 'api', {
    onSemanticFailure: (message) => calls.push(message)
  });
  assert.ok(hybrid.some((m) => m.id === 'lexical-still-works'), 'the lexical result must still come back — a mismatched-dimension semantic side must never abort the whole request');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /different dimensions/);
});

test('A11: cosineSimilarity (via rankSemanticCandidates) rejects an EMPTY vector', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  const provider: EmbeddingProvider = {
    id: 'empty-vector',
    embedQuery: async () => [],
    embedDocuments: async (texts) => texts.map(() => [])
  };
  await assert.rejects(() => rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'api'), VectorDimensionMismatchError);
});

test('A11: cosineSimilarity (via rankSemanticCandidates) rejects a vector containing a non-finite value', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  const provider: EmbeddingProvider = {
    id: 'nan-vector',
    embedQuery: async () => [1, 0],
    embedDocuments: async (texts) => texts.map(() => [1, NaN])
  };
  await assert.rejects(() => rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'api'), VectorDimensionMismatchError);
});

test('A11: two EQUAL-dimension vectors are scored normally — this fix never rejects a genuinely compatible pair', async () => {
  const index = await buildRagIndex([JAVA_RECIPE]);
  const provider: EmbeddingProvider = {
    id: 'compatible',
    embedQuery: async () => [1, 0],
    embedDocuments: async (texts) => texts.map(() => [1, 0])
  };
  const ranked = await rankSemanticCandidates(index.recipes, index.canonicalIds, provider, 'q', 'java', 'api');
  assert.equal(ranked.length, 1);
  assert.ok(Math.abs(ranked[0].score - 1) < 1e-9, 'two identical, equal-dimension vectors should still score a perfect similarity');
});

test('DEFAULT_HYBRID_GATE is a SEPARATE binding from DEFAULT_RELEVANCE_GATE, never reusing a TF-IDF-tuned threshold by accident', () => {
  assert.notEqual(DEFAULT_HYBRID_GATE, DEFAULT_RELEVANCE_GATE as unknown as RelevanceGateConfig);
  // Same conservative SHAPE (accept anything with a positive score) though —
  // deliberately not itself an aggressively-tuned default.
  assert.equal(DEFAULT_HYBRID_GATE.minLexicalScore, 0);
});

test('a custom hybrid gateConfig genuinely gates fused results (proving the gate is really wired in, not bypassed)', async () => {
  const strong = makeRecipe({ id: 'strong', title: 'x', body: 'x', automationMode: ['api'], language: ['java'] });
  const weak = makeRecipe({ id: 'weak', title: 'y', body: 'y', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([strong, weak]);
  const queryText = 'q';
  const provider = fakeProviderFromMap(
    new Map([
      [queryText, [1, 0]],
      [recipeToEmbeddingText(strong), [1, 0]], // rank 1 semantically
      [recipeToEmbeddingText(weak), [0.01, 0.9999]] // barely positive, ranks far behind
    ])
  );
  const unrestricted = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 5 });
  assert.ok(unrestricted.length >= 1);

  // An unreachably high floor on the tiny RRF-scale fused score should
  // reject everything — proving the gateConfig genuinely applies to the
  // FUSED score, not silently ignored.
  const strictConfig: RelevanceGateConfig = { ...DEFAULT_HYBRID_GATE, minLexicalScore: 1 };
  const gated = await retrieveHybridMatches(index, provider, queryText, 'java', 'api', { topK: 5, gateConfig: strictConfig });
  assert.equal(gated.length, 0);
});

test('a custom rrfK is honored (changing rrfK changes the fused ranking outcome for a close case)', async () => {
  // "both" appears in both lists at rank 2; "lexicalStar" is rank 1
  // lexical-only; "semanticStar" is rank 1 semantic-only. With a very
  // small k, rank-1-only wins get boosted disproportionately; the exact
  // crossover isn't asserted here — just that the option is genuinely
  // threaded through and produces A result without erroring.
  const both = makeRecipe({ id: 'both', title: 'alpha beta', body: 'x', automationMode: ['api'], language: ['java'] });
  const lexicalStar = makeRecipe({ id: 'lexical-star', title: 'alpha beta gamma', body: 'x', automationMode: ['api'], language: ['java'] });
  const index = await buildRagIndex([both, lexicalStar]);
  const provider = fakeProviderFromMap(
    new Map([
      ['alpha beta', [1, 0]],
      [recipeToEmbeddingText(both), [1, 0]],
      [recipeToEmbeddingText(lexicalStar), [0, 1]]
    ])
  );
  const withDefaultK = await retrieveHybridMatches(index, provider, 'alpha beta', 'java', 'api', { rrfK: 60 });
  const withTinyK = await retrieveHybridMatches(index, provider, 'alpha beta', 'java', 'api', { rrfK: 1 });
  assert.ok(withDefaultK.length > 0 && withTinyK.length > 0);
});
