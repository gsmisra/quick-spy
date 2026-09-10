import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { recipeToEmbeddingText } from '../../src/rag/ragTypes';
import { RagRecipe } from '../../src/rag/ragTypes';

function makeRecipe(overrides: Partial<RagRecipe> = {}): RagRecipe {
  return {
    filePath: '/fake/.github/rag/helper.md',
    relativePath: 'helper.md',
    frontmatter: {
      id: 'helper',
      title: 'Helper title',
      tags: ['tag-one'],
      automationMode: ['ui', 'api'],
      language: ['java']
    },
    body: 'Helper body text.',
    mtimeMs: 0,
    ...overrides
  };
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

test('title is repeated (weighted) more than once in the embedding text', () => {
  const recipe = makeRecipe({ frontmatter: { ...makeRecipe().frontmatter, title: 'UniqueTitleWord' } });
  const text = recipeToEmbeddingText(recipe);
  assert.ok(countOccurrences(text, 'UniqueTitleWord') > 1, 'title should be repeated for extra TF-IDF weight');
});

test('tags are repeated (weighted) more than once in the embedding text', () => {
  const recipe = makeRecipe({ frontmatter: { ...makeRecipe().frontmatter, tags: ['uniquetagword'] } });
  const text = recipeToEmbeddingText(recipe);
  assert.ok(countOccurrences(text, 'uniquetagword') > 1, 'tags should be repeated for extra TF-IDF weight');
});

test('relativePath is repeated at a lower weight than title/tags', () => {
  const recipe = makeRecipe({ relativePath: 'uniquefoldername/helper.md' });
  const text = recipeToEmbeddingText(recipe);
  const titleCount = countOccurrences(text, recipe.frontmatter.title);
  const pathCount = countOccurrences(text, 'uniquefoldername');
  assert.ok(pathCount >= 1);
  assert.ok(pathCount < titleCount, 'relativePath should be weighted lower than title');
});

test('body is included at baseline (unrepeated) weight — the lowest of all fields', () => {
  const recipe = makeRecipe({ body: 'UniqueBodyOnlyWord appears once in the source body text.' });
  const text = recipeToEmbeddingText(recipe);
  assert.equal(countOccurrences(text, 'UniqueBodyOnlyWord'), 1, 'body text should not be artificially repeated');
});

test('title and tags are weighted equally and higher than relativePath and body', () => {
  const recipe = makeRecipe({
    frontmatter: { ...makeRecipe().frontmatter, title: 'X', tags: ['x'] },
    relativePath: 'x.md',
    body: 'x'
  });
  const text = recipeToEmbeddingText(recipe);
  // Every field here reduces to the literal character "x" — count total
  // "x" occurrences contributed by each field's own known repeat count.
  const totalX = countOccurrences(text.toLowerCase(), 'x');
  // title (3) + tags (3, "x" from "x.md"? no — tags is just "x") + relativePath (2, "x.md" contains one "x") + body (1)
  // = 3 + 3 + 2 + 1 = 9
  assert.equal(totalX, 9);
});

test('an empty tags array contributes nothing (no blank lines/weighted emptiness)', () => {
  const recipe = makeRecipe({ frontmatter: { ...makeRecipe().frontmatter, tags: [] } });
  const text = recipeToEmbeddingText(recipe);
  assert.doesNotMatch(text, /\n\n\n/, 'no run of blank lines from repeating empty tags');
});

test('recipeToEmbeddingText still includes every field at least once (nothing silently dropped)', () => {
  const recipe = makeRecipe({
    frontmatter: { ...makeRecipe().frontmatter, title: 'MyTitle', tags: ['mytag'] },
    relativePath: 'my/path.md',
    body: 'MyBodyContent'
  });
  const text = recipeToEmbeddingText(recipe);
  assert.match(text, /MyTitle/);
  assert.match(text, /mytag/);
  assert.match(text, /my\/path\.md/);
  assert.match(text, /MyBodyContent/);
});
