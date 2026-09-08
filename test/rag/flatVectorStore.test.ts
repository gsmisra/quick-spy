import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { Document } from '@langchain/core/documents';
import { LocalFlatVectorStore } from '../../src/rag/flatVectorStore';
import { TfIdfEmbeddings } from '../../src/rag/tfidfEmbeddings';

function makeDoc(id: string, pageContent: string, metadata: Record<string, unknown>): Document {
  return new Document({ pageContent, metadata: { id, ...metadata } });
}

test('similaritySearchVectorWithScore returns exact top-k in descending score order', async () => {
  const embeddings = new TfIdfEmbeddings();
  const store = new LocalFlatVectorStore(embeddings);
  const texts = ['postgres database query table', 'bearer token http auth request', 'screenshot page save disk'];
  embeddings.fit(texts);
  const vectors = await embeddings.embedDocuments(texts);
  await store.reset(
    vectors,
    texts.map((t, i) => makeDoc(`doc-${i}`, t, {}))
  );

  const query = await embeddings.embedQuery('query a postgres table');
  const results = await store.similaritySearchVectorWithScore(query, 2);

  assert.equal(results.length, 2);
  assert.equal(results[0][0].metadata.id, 'doc-0');
  assert.ok(results[0][1] >= results[1][1], 'results must be sorted by descending score');
});

test('a metadata filter restricts results to matching documents only', async () => {
  const embeddings = new TfIdfEmbeddings();
  const store = new LocalFlatVectorStore(embeddings);
  const texts = ['postgres query helper java', 'postgres query helper python'];
  embeddings.fit(texts);
  const vectors = await embeddings.embedDocuments(texts);
  await store.reset(vectors, [
    makeDoc('java-doc', texts[0], { language: ['java'] }),
    makeDoc('python-doc', texts[1], { language: ['python'] })
  ]);

  const query = await embeddings.embedQuery('postgres query helper');
  const results = await store.similaritySearchVectorWithScore(query, 5, { language: 'python' });

  assert.equal(results.length, 1);
  assert.equal(results[0][0].metadata.id, 'python-doc');
});

test('an array-valued metadata field matches when the filter value is one of its entries', async () => {
  const embeddings = new TfIdfEmbeddings();
  const store = new LocalFlatVectorStore(embeddings);
  embeddings.fit(['shared helper for both modes']);
  const vectors = await embeddings.embedDocuments(['shared helper for both modes']);
  await store.reset(vectors, [makeDoc('shared', 'shared helper for both modes', { automationMode: ['ui', 'api'] })]);

  const query = await embeddings.embedQuery('shared helper');
  const uiResults = await store.similaritySearchVectorWithScore(query, 5, { automationMode: 'ui' });
  const apiResults = await store.similaritySearchVectorWithScore(query, 5, { automationMode: 'api' });
  const noResults = await store.similaritySearchVectorWithScore(query, 5, { automationMode: 'neither' });

  assert.equal(uiResults.length, 1);
  assert.equal(apiResults.length, 1);
  assert.equal(noResults.length, 0);
});

test('reset() replaces prior contents rather than appending to them', async () => {
  const embeddings = new TfIdfEmbeddings();
  const store = new LocalFlatVectorStore(embeddings);
  embeddings.fit(['first batch', 'second batch']);
  const vectors = await embeddings.embedDocuments(['first batch', 'second batch']);

  await store.reset([vectors[0]], [makeDoc('first', 'first batch', {})]);
  assert.equal(store.size, 1);

  await store.reset([vectors[1]], [makeDoc('second', 'second batch', {})]);
  assert.equal(store.size, 1);
  const query = await embeddings.embedQuery('first batch');
  const results = await store.similaritySearchVectorWithScore(query, 5);
  assert.equal(results.length, 1);
  assert.equal(results[0][0].metadata.id, 'second');
});

test('an empty store returns no results for any query', async () => {
  const embeddings = new TfIdfEmbeddings();
  embeddings.fit(['placeholder']);
  const store = new LocalFlatVectorStore(embeddings);
  const query = await embeddings.embedQuery('placeholder');
  const results = await store.similaritySearchVectorWithScore(query, 5);
  assert.deepEqual(results, []);
});
