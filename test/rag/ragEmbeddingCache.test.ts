import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CachingEmbeddingProvider } from '../../src/rag/ragEmbeddingCache';
import { EmbeddingProvider } from '../../src/rag/ragEmbeddingProvider';

/** A fake, deterministic underlying provider that counts exactly how many
 * texts it was actually asked to embed — the whole point of the tests
 * below is proving the cache genuinely AVOIDS calling this for text it has
 * already seen, without any real network/model involved. */
class CountingFakeProvider implements EmbeddingProvider {
  readonly id = 'fake';
  embedCalls = 0;
  embeddedTexts: string[] = [];

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.embedCalls += 1;
    this.embeddedTexts.push(...texts);
    return texts.map((text) => [text.length]); // trivially deterministic "vector"
  }

  async embedQuery(text: string): Promise<number[]> {
    const [vector] = await this.embedDocuments([text]);
    return vector;
  }
}

test('embedDocuments on a first call passes everything through to the underlying provider', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  const result = await cache.embedDocuments(['alpha', 'beta']);
  assert.deepEqual(result, [[5], [4]]);
  assert.equal(fake.embedCalls, 1);
  assert.deepEqual(fake.embeddedTexts, ['alpha', 'beta']);
});

test('embedDocuments on a SECOND call with the exact same texts hits the cache — zero further underlying calls', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['alpha', 'beta']);
  const result = await cache.embedDocuments(['alpha', 'beta']);
  assert.deepEqual(result, [[5], [4]]);
  assert.equal(fake.embedCalls, 1, 'the underlying provider should not have been called again');
});

test('embedDocuments with a MIX of cached and new texts only sends the new ones to the underlying provider', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['alpha']);
  const result = await cache.embedDocuments(['alpha', 'gamma']);
  assert.deepEqual(result, [[5], [5]]);
  assert.equal(fake.embedCalls, 2);
  assert.deepEqual(fake.embeddedTexts, ['alpha', 'gamma'], 'the already-cached "alpha" must not be re-sent');
});

test('results preserve the ORIGINAL requested order even when cached and fresh entries are interleaved', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['bb']); // pre-warm one entry
  const result = await cache.embedDocuments(['a', 'bb', 'ccc']);
  assert.deepEqual(result, [[1], [2], [3]]);
});

// A12: embedQuery and embedDocuments now use SEPARATE cache namespaces — a
// document embedding cached for some text must NEVER be silently reused as
// that same text's QUERY embedding (a real asymmetric provider can — and
// several common real ones do — return a genuinely different vector for
// the two). See ragEmbeddingCache.ts's own doc comment for the full
// reasoning; this replaces a PRE-EXISTING test that had encoded the OLD,
// buggy shared-cache behavior ("embedQuery reuses embedDocuments' cached
// vector for identical text") as if it were correct.
test('A12: embedQuery on text ALREADY cached via embedDocuments still calls through to the underlying provider\'s OWN embedQuery — separate namespaces, never silently reused across them', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['shared text']);
  assert.equal(fake.embedCalls, 1);
  const queryResult = await cache.embedQuery('shared text');
  assert.deepEqual(queryResult, [11]);
  assert.equal(fake.embedCalls, 2, 'embedQuery must independently call through the underlying provider — never short-circuit via the document cache');
});

test('embedQuery on a genuinely new text calls through and then caches it', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  const first = await cache.embedQuery('new text');
  const second = await cache.embedQuery('new text');
  assert.deepEqual(first, second);
  assert.equal(fake.embedCalls, 1);
});

test('an empty embedDocuments call never touches the underlying provider', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  const result = await cache.embedDocuments([]);
  assert.deepEqual(result, []);
  assert.equal(fake.embedCalls, 0);
});

test('size reflects the number of distinct cached texts, and clear() empties it', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['a', 'b', 'a']); // "a" only counted once
  assert.equal(cache.size, 2);
  cache.clear();
  assert.equal(cache.size, 0);
});

test('two DIFFERENT texts that happen to have the same length still get distinct cache entries (content-hash keyed, not length-keyed)', async () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  await cache.embedDocuments(['abcde']);
  await cache.embedDocuments(['fghij']); // same length as "abcde"
  assert.equal(fake.embedCalls, 2, 'a different text of the same length must still trigger its own underlying call');
});

test('id is derived from the underlying provider\'s own id, prefixed to mark it as cached', () => {
  const fake = new CountingFakeProvider();
  const cache = new CachingEmbeddingProvider(fake);
  assert.equal(cache.id, 'cached:fake');
});

test('a mismatched vector count from the underlying provider throws rather than silently misaligning results', async () => {
  const brokenProvider: EmbeddingProvider = {
    id: 'broken',
    embedQuery: async () => [0],
    embedDocuments: async () => [[1]] // always returns 1 vector regardless of input size
  };
  const cache = new CachingEmbeddingProvider(brokenProvider);
  await assert.rejects(() => cache.embedDocuments(['a', 'b']));
});

// --- A12: asymmetric provider (query/document vectors genuinely differ for
// the identical text) — the review's own reproduced shape and suggested test.

/** A provider modeling a REAL, common asymmetric embedding API (E5, BGE,
 * Cohere's `input_type`, ...) — the SAME text embeds to a DIFFERENT vector
 * depending on whether it's asked for as a query or a document. Counts
 * each kind of call separately so a test can prove EXACTLY which of the
 * underlying provider's own methods actually ran. */
class AsymmetricFakeProvider implements EmbeddingProvider {
  readonly id = 'asymmetric-fake';
  documentCalls = 0;
  queryCalls = 0;

  async embedDocuments(texts: string[]): Promise<number[][]> {
    this.documentCalls += 1;
    return texts.map((text) => [text.length, 0]); // "document-space" vector
  }

  async embedQuery(text: string): Promise<number[]> {
    this.queryCalls += 1;
    return [0, text.length]; // "query-space" vector — DELIBERATELY different shape
  }
}

test('A12: an asymmetric provider\'s DISTINCT query vs. document vectors for the IDENTICAL text are both preserved, never conflated', async () => {
  const asymmetric = new AsymmetricFakeProvider();
  const cache = new CachingEmbeddingProvider(asymmetric);

  const [documentVector] = await cache.embedDocuments(['shared text']);
  const queryVector = await cache.embedQuery('shared text');

  assert.deepEqual(documentVector, [11, 0]);
  assert.deepEqual(queryVector, [0, 11]);
  assert.notDeepEqual(documentVector, queryVector, 'the two must be genuinely different — this is the whole point of an asymmetric provider');
  assert.equal(asymmetric.documentCalls, 1);
  assert.equal(asymmetric.queryCalls, 1, 'the underlying provider\'s OWN embedQuery must actually have been called — never bypassed via the document cache');
});

test('A12: repeated hits land in BOTH namespaces independently — a cache hit in one never masks a genuine miss in the other', async () => {
  const asymmetric = new AsymmetricFakeProvider();
  const cache = new CachingEmbeddingProvider(asymmetric);

  await cache.embedDocuments(['shared text']);
  await cache.embedQuery('shared text');
  assert.equal(asymmetric.documentCalls, 1);
  assert.equal(asymmetric.queryCalls, 1);

  // Second round — BOTH should now be cache hits, zero further underlying calls.
  const documentAgain = await cache.embedDocuments(['shared text']);
  const queryAgain = await cache.embedQuery('shared text');
  assert.equal(asymmetric.documentCalls, 1, 'the second embedDocuments call must be a cache hit');
  assert.equal(asymmetric.queryCalls, 1, 'the second embedQuery call must be a cache hit');
  assert.deepEqual(documentAgain, [[11, 0]]);
  assert.deepEqual(queryAgain, [0, 11]);
});

test('A12: size counts the SAME text cached in BOTH namespaces as 2 distinct entries, never deduplicated against each other', async () => {
  const asymmetric = new AsymmetricFakeProvider();
  const cache = new CachingEmbeddingProvider(asymmetric);
  await cache.embedDocuments(['shared text']);
  await cache.embedQuery('shared text');
  assert.equal(cache.size, 2);
});

test('A12: clear() empties BOTH namespaces together — provider/model isolation (a config change discards everything) is unaffected by the two-namespace split', async () => {
  const asymmetric = new AsymmetricFakeProvider();
  const cache = new CachingEmbeddingProvider(asymmetric);
  await cache.embedDocuments(['shared text']);
  await cache.embedQuery('shared text');
  assert.equal(cache.size, 2);
  cache.clear();
  assert.equal(cache.size, 0);
  await cache.embedDocuments(['shared text']);
  await cache.embedQuery('shared text');
  assert.equal(asymmetric.documentCalls, 2, 'a cleared cache must genuinely re-fetch, not silently keep serving stale entries');
  assert.equal(asymmetric.queryCalls, 2);
});
