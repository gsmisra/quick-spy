import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildRagIndex, dedupeRecipeIds } from '../../src/rag/ragIndexBuilder';
import { RagRecipe } from '../../src/rag/ragTypes';

function makeRecipe(id: string, filePath: string, body = 'body'): RagRecipe {
  return {
    filePath,
    relativePath: filePath.replace('/fake/.github/rag/', ''),
    mtimeMs: 0,
    frontmatter: { id, title: `Title for ${id}`, tags: [], automationMode: ['ui', 'api'], language: ['java', 'python'] },
    body
  };
}

// --- dedupeRecipeIds (F02 fix) -----------------------------------------------

test('a non-colliding id is left completely untouched', () => {
  const recipes = [makeRecipe('a', '/fake/.github/rag/a.md'), makeRecipe('b', '/fake/.github/rag/b.md')];
  assert.deepEqual(dedupeRecipeIds(recipes), ['a', 'b']);
});

test('EVERY occurrence of a colliding id is disambiguated — never leaves exactly one bare "winner"', () => {
  const recipes = [makeRecipe('dup', '/fake/.github/rag/one.md'), makeRecipe('dup', '/fake/.github/rag/two.md')];
  const result = dedupeRecipeIds(recipes);
  assert.notEqual(result[0], 'dup');
  assert.notEqual(result[1], 'dup');
  assert.notEqual(result[0], result[1]);
  assert.ok(result[0].startsWith('dup-'));
  assert.ok(result[1].startsWith('dup-'));
});

test('disambiguation is deterministic and independent of array order', () => {
  const a = makeRecipe('dup', '/fake/.github/rag/one.md');
  const b = makeRecipe('dup', '/fake/.github/rag/two.md');
  const forward = dedupeRecipeIds([a, b]);
  const reversed = dedupeRecipeIds([b, a]);
  // Whichever position 'one.md' ends up in, it always gets the SAME
  // disambiguated id — the result is keyed by the recipe's own filePath,
  // not by its position in the array.
  const idForOne = forward[0];
  const idForOneReversed = reversed[1];
  assert.equal(idForOne, idForOneReversed);
});

test('only the ACTUALLY colliding ids are touched — a third, unrelated id is untouched', () => {
  const recipes = [makeRecipe('dup', '/fake/.github/rag/one.md'), makeRecipe('dup', '/fake/.github/rag/two.md'), makeRecipe('unique', '/fake/.github/rag/three.md')];
  const result = dedupeRecipeIds(recipes);
  assert.equal(result[2], 'unique');
});

test('a three-way collision disambiguates all three distinctly', () => {
  const recipes = [makeRecipe('dup', '/fake/.github/rag/a.md'), makeRecipe('dup', '/fake/.github/rag/b.md'), makeRecipe('dup', '/fake/.github/rag/c.md')];
  const result = dedupeRecipeIds(recipes);
  assert.equal(new Set(result).size, 3);
});

test('an empty recipe list dedupes to an empty list', () => {
  assert.deepEqual(dedupeRecipeIds([]), []);
});

// --- buildRagIndex actually USES the deduped id (the real bug this fixes) ---

test('buildRagIndex retrieval carries the DEDUPED id, not the raw colliding frontmatter.id, so two distinct recipes never collapse into one retrieval result', async () => {
  const first = makeRecipe('shared-id', '/fake/.github/rag/first.md', 'unique body mentioning apples');
  const second = makeRecipe('shared-id', '/fake/.github/rag/second.md', 'unique body mentioning oranges');
  const index = await buildRagIndex([first, second]);
  const results = await index.store.similaritySearchVectorWithScore(await index.embeddings.embedQuery('apples oranges'), 10);
  const ids = results.map(([doc]) => (doc.metadata as { id: string }).id);
  assert.equal(new Set(ids).size, 2, 'both distinct recipes must be independently retrievable, never collapsed by a shared frontmatter id');
});

test('buildRagIndex leaves a non-colliding id exactly as-is in the resulting metadata', async () => {
  const recipe = makeRecipe('postgres-helper', '/fake/.github/rag/a.md');
  const index = await buildRagIndex([recipe]);
  const results = await index.store.similaritySearchVectorWithScore(await index.embeddings.embedQuery('title'), 10);
  assert.equal((results[0][0].metadata as { id: string }).id, 'postgres-helper');
});

// --- A06: RagIndex.canonicalIds must match the SAME deduped ids baked into
// the vector store's own metadata, so any consumer keying off `recipes` by
// id (see ragHybridRetriever.ts) sees an identically-deduped identity space
// as the vector store itself — never the raw, possibly-colliding
// `frontmatter.id`. ------------------------------------------------------

test('A06: RagIndex.canonicalIds is the SAME order/length as recipes, and matches dedupeRecipeIds() exactly', async () => {
  const first = makeRecipe('shared-id', '/fake/.github/rag/first.md');
  const second = makeRecipe('shared-id', '/fake/.github/rag/second.md');
  const third = makeRecipe('unique-id', '/fake/.github/rag/third.md');
  const recipes = [first, second, third];
  const index = await buildRagIndex(recipes);
  assert.deepEqual(index.canonicalIds, dedupeRecipeIds(recipes));
  assert.equal(index.canonicalIds.length, index.recipes.length);
});

test('A06: RagIndex.canonicalIds matches the vector store metadata id for every recipe, position for position', async () => {
  const first = makeRecipe('shared-id', '/fake/.github/rag/first.md', 'apples');
  const second = makeRecipe('shared-id', '/fake/.github/rag/second.md', 'oranges');
  const index = await buildRagIndex([first, second]);
  const results = await index.store.similaritySearchVectorWithScore(await index.embeddings.embedQuery('apples'), 10);
  for (const [doc] of results) {
    const metadata = doc.metadata as { id: string; recipeIndex: number };
    assert.equal(metadata.id, index.canonicalIds[metadata.recipeIndex], 'the store metadata id and canonicalIds[recipeIndex] must always agree');
  }
});
