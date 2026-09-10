import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { CharNgramStandInProvider } from '../../../src/rag/benchmark/ragCharNgramStandInProvider';

test('embedQuery is deterministic — the same text always embeds to the same vector', async () => {
  const provider = new CharNgramStandInProvider();
  const a = await provider.embedQuery('connect to the database');
  const b = await provider.embedQuery('connect to the database');
  assert.deepEqual(a, b);
});

test('embedQuery produces a vector of the configured fixed dimension', async () => {
  const provider = new CharNgramStandInProvider(3, 128);
  const vector = await provider.embedQuery('some text');
  assert.equal(vector.length, 128);
});

test('two very similar texts (small edit distance) produce a HIGH cosine similarity', async () => {
  const provider = new CharNgramStandInProvider();
  const a = await provider.embedQuery('connect to the postgres database');
  const b = await provider.embedQuery('connect to the postgres databases'); // one extra char
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  assert.ok(dot > 0.9, `expected near-identical text to score a high cosine similarity, got ${dot}`);
});

test('two completely different texts produce a LOW cosine similarity', async () => {
  const provider = new CharNgramStandInProvider();
  const a = await provider.embedQuery('connect to the postgres database');
  const b = await provider.embedQuery('zzqvex blorptak wibbleflorp');
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  assert.ok(dot < 0.3, `expected unrelated text to score a low cosine similarity, got ${dot}`);
});

test('is case-insensitive and whitespace-normalizing', async () => {
  const provider = new CharNgramStandInProvider();
  const a = await provider.embedQuery('Connect To The Database');
  const b = await provider.embedQuery('connect   to the database');
  assert.deepEqual(a, b);
});

test('embedDocuments embeds each text independently, matching embedQuery for the same text', async () => {
  const provider = new CharNgramStandInProvider();
  const [docVector] = await provider.embedDocuments(['hello world']);
  const queryVector = await provider.embedQuery('hello world');
  assert.deepEqual(docVector, queryVector);
});

test('an empty string embeds to an all-zero vector, not an error', async () => {
  const provider = new CharNgramStandInProvider();
  const vector = await provider.embedQuery('');
  assert.ok(vector.every((v) => v === 0));
});

test('a very short string (shorter than the ngram size) still embeds without error', async () => {
  const provider = new CharNgramStandInProvider(3);
  const vector = await provider.embedQuery('ab');
  assert.equal(vector.length, 256);
  assert.ok(vector.some((v) => v !== 0));
});

test('the resulting vector is L2-normalized (unit length) for any non-empty text', async () => {
  const provider = new CharNgramStandInProvider();
  const vector = await provider.embedQuery('some reasonably long piece of text to embed');
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9);
});

test('id reflects the configured ngram size and dimensions, distinguishing different configurations', () => {
  const a = new CharNgramStandInProvider(3, 256);
  const b = new CharNgramStandInProvider(4, 256);
  const c = new CharNgramStandInProvider(3, 128);
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.id, c.id);
});
