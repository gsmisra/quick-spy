import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { TfIdfEmbeddings } from '../../src/rag/tfidfEmbeddings';

test('tokenize lowercases and splits on non-alphanumeric, dropping single-char tokens', () => {
  const tokens = TfIdfEmbeddings.tokenize('Connect to Postgres: query_table(id=1) -> a b OK');
  assert.deepEqual(tokens, ['connect', 'to', 'postgres', 'query_table', 'id', 'ok']);
});

test('throws if embedding is attempted before fit()', async () => {
  const embeddings = new TfIdfEmbeddings();
  await assert.rejects(() => embeddings.embedQuery('anything'), /fit\(\) must be called/);
});

test('a document sharing more vocabulary with the query scores higher via dot product', async () => {
  const embeddings = new TfIdfEmbeddings();
  const docs = [
    'connect to postgres database and run a sql query against a table',
    'send a bearer token http request and assert the response status code',
    'take a screenshot of the current page and save it to disk'
  ];
  embeddings.fit(docs);
  const vectors = await embeddings.embedDocuments(docs);
  const query = await embeddings.embedQuery('open a postgres connection and query the orders table');

  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const scores = vectors.map((v) => dot(v, query));

  assert.ok(scores[0] > scores[1], 'postgres doc should outscore the http-request doc');
  assert.ok(scores[0] > scores[2], 'postgres doc should outscore the screenshot doc');
});

test('vectors are L2-normalized (dot product with itself is ~1 for any non-empty document)', async () => {
  const embeddings = new TfIdfEmbeddings();
  const docs = ['alpha beta gamma', 'gamma delta epsilon'];
  embeddings.fit(docs);
  const [vectorA] = await embeddings.embedDocuments(docs);
  const selfDot = vectorA.reduce((sum, v) => sum + v * v, 0);
  assert.ok(Math.abs(selfDot - 1) < 1e-9, `expected ~1, got ${selfDot}`);
});

test('an empty or all-out-of-vocabulary query embeds to an all-zero vector, not an error', async () => {
  const embeddings = new TfIdfEmbeddings();
  embeddings.fit(['postgres database query']);
  const empty = await embeddings.embedQuery('');
  const unseen = await embeddings.embedQuery('zzz qqq xxx');
  assert.ok(empty.every((v) => v === 0));
  assert.ok(unseen.every((v) => v === 0));
});

test('vocabularySize reflects unique unigrams AND bigrams across the fitted corpus', () => {
  const embeddings = new TfIdfEmbeddings();
  embeddings.fit(['alpha beta', 'beta gamma']);
  // Unigrams: alpha, beta, gamma. Bigrams: alpha_beta, beta_gamma.
  assert.equal(embeddings.vocabularySize, 5);
});

test('extractFeatures adds an adjacent-pair bigram for every two consecutive tokens', () => {
  const features = TfIdfEmbeddings.extractFeatures('database connection pool');
  assert.deepEqual(features, ['database', 'connection', 'pool', 'database_connection', 'connection_pool']);
});

test('extractFeatures canonicalizes a known abbreviation onto its full-word synonym', () => {
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('db'), ['database']);
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('postgres'), ['postgresql']);
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('creds'), ['credential']);
});

test('extractFeatures never merges two different database vendor names into each other', () => {
  const pg = TfIdfEmbeddings.extractFeatures('postgres');
  const my = TfIdfEmbeddings.extractFeatures('mysql');
  assert.notDeepEqual(pg, my);
});

test('extractFeatures folds plain plurals onto their singular form', () => {
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('tables'), ['table']);
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('queries'), ['query']);
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('connections'), ['connection']);
});

test('extractFeatures leaves a short, already-meaningful word alone rather than over-stemming it', () => {
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('sql'), ['sql']);
  assert.deepEqual(TfIdfEmbeddings.extractFeatures('api'), ['api']);
});

test('a scenario using an abbreviation still matches a recipe tagged with the full word', async () => {
  const embeddings = new TfIdfEmbeddings();
  const docs = ['connect to the database and run a query', 'take a screenshot of the current page'];
  embeddings.fit(docs);
  const vectors = await embeddings.embedDocuments(docs);
  // "db" query never appears verbatim in either document, but canonicalizes
  // to "database" — the same term the first document's own "database"
  // resolves to — so it should still score that document highest.
  const query = await embeddings.embedQuery('open a db connection and run a query');

  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const scores = vectors.map((v) => dot(v, query));
  assert.ok(scores[0] > scores[1], 'the database doc should outscore the screenshot doc via the db->database synonym');
});
