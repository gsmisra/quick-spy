import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { buildRagIndex } from '../../src/rag/ragIndexBuilder';
import { retrieveRagMatches, formatRagPromptSection } from '../../src/rag/ragRetriever';
import { RagRecipe } from '../../src/rag/ragTypes';

function makeRecipe(options: {
  id: string;
  title: string;
  body: string;
  tags?: string[];
  automationMode?: RagRecipe['frontmatter']['automationMode'];
  language?: RagRecipe['frontmatter']['language'];
  imports?: RagRecipe['frontmatter']['imports'];
}): RagRecipe {
  return {
    filePath: `/fake/.github/rag/${options.id}.md`,
    mtimeMs: 0,
    frontmatter: {
      id: options.id,
      title: options.title,
      tags: options.tags ?? [],
      automationMode: options.automationMode ?? ['ui', 'api'],
      language: options.language ?? ['java', 'python'],
      imports: options.imports
    },
    body: options.body
  };
}

const POSTGRES_RECIPE = makeRecipe({
  id: 'postgres-query-and-validate',
  title: 'Query a Postgres table and validate a result',
  body: '```java\nvar row = PostgresHelper.queryOne(conn, sql, id);\n```',
  tags: ['postgres', 'database', 'sql', 'query'],
  automationMode: ['api'],
  language: ['java'],
  imports: { java: ['com.acme.testutil.db.PostgresHelper'] }
});

const SCREENSHOT_RECIPE = makeRecipe({
  id: 'take-screenshot',
  title: 'Take a screenshot and save it to disk',
  body: '```python\ntake_screenshot(page, "out.png")\n```',
  tags: ['screenshot', 'ui', 'debugging'],
  automationMode: ['ui'],
  language: ['python'],
  imports: { python: ['testutil.screenshot'] }
});

test('retrieves the relevant recipe for a matching scenario and filters by mode/language', async () => {
  const index = await buildRagIndex([POSTGRES_RECIPE, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(
    index,
    'Login to Postgres database, query a specific table using a query, validate the result',
    'java',
    'api'
  );
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, 'postgres-query-and-validate');
});

test('a recipe restricted to a different language never appears even if the text scores well', async () => {
  const index = await buildRagIndex([POSTGRES_RECIPE, SCREENSHOT_RECIPE]);
  // Same query, but asking for python/ui — postgres recipe is java/api only.
  const matches = await retrieveRagMatches(index, 'postgres database query table validate', 'python', 'ui');
  assert.equal(matches.find((m) => m.id === 'postgres-query-and-validate'), undefined);
});

test('an unrelated query returns no matches rather than the least-bad option', async () => {
  const index = await buildRagIndex([POSTGRES_RECIPE, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(index, 'zzzzzz completely unrelated nonsense qqqqqq', 'java', 'api');
  assert.equal(matches.length, 0);
});

test('an empty query string returns no matches', async () => {
  const index = await buildRagIndex([POSTGRES_RECIPE, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(index, '   ', 'java', 'api');
  assert.equal(matches.length, 0);
});

test('formatRagPromptSection returns an empty string for no matches (zero prompt cost)', () => {
  assert.equal(formatRagPromptSection([], 'java'), '');
});

test('formatRagPromptSection includes the title, body, and de-duplicated imports for the target language', () => {
  const section = formatRagPromptSection(
    [
      { id: 'a', title: 'Helper A', body: 'code A', imports: { java: ['com.acme.A', 'com.acme.Shared'] }, score: 0.9 },
      { id: 'b', title: 'Helper B', body: 'code B', imports: { java: ['com.acme.Shared'] }, score: 0.5 }
    ],
    'java'
  );
  assert.match(section, /Helper A/);
  assert.match(section, /Helper B/);
  assert.match(section, /code A/);
  assert.match(section, /code B/);
  assert.match(section, /com\.acme\.A/);
  // De-duplicated: "com.acme.Shared" appears in both recipes but should
  // only be listed once in the required-imports block.
  const sharedOccurrences = section.split('com.acme.Shared').length - 1;
  assert.equal(sharedOccurrences, 1);
});

test('formatRagPromptSection omits python imports when formatting for java', () => {
  const section = formatRagPromptSection(
    [{ id: 'a', title: 'Helper A', body: 'code A', imports: { python: ['testutil.a'] }, score: 0.9 }],
    'java'
  );
  assert.doesNotMatch(section, /testutil\.a/);
});
