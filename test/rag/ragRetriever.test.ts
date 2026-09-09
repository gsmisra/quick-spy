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
  /** Defaults to a flat "<id>.md" at the rag root, matching every existing
   * fixture's prior behavior — pass an explicit nested path (e.g.
   * "database/cassandra/cassandra-helper.md") for tests specifically
   * exercising folder/filename-based matching. */
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

const CASSANDRA_RECIPE_NO_MENTION_IN_CONTENT = makeRecipe({
  id: 'connection-helper',
  // Deliberately generic title/tags/body — NONE of them mention
  // "cassandra" anywhere. Only the folder structure does.
  title: 'Connection helper',
  body: '```java\nvar row = ConnectionHelper.queryOne(session, cql, id);\n```',
  tags: ['database', 'query'],
  automationMode: ['ui', 'api'],
  language: ['java'],
  relativePath: 'database/cassandra/connection-helper.md'
});

test('a recipe is matchable purely by its FOLDER name, even when that word appears nowhere in title/tags/body', async () => {
  const index = await buildRagIndex([CASSANDRA_RECIPE_NO_MENTION_IN_CONTENT, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(index, 'connect to cassandra and run a query', 'java', 'api');
  assert.ok(matches.some((m) => m.id === 'connection-helper'), 'expected the folder-name "cassandra" alone to surface this recipe');
});

test('folder-name matching works identically for UI Automation mode as it does for API Automation mode', async () => {
  const index = await buildRagIndex([CASSANDRA_RECIPE_NO_MENTION_IN_CONTENT, SCREENSHOT_RECIPE]);
  const uiMatches = await retrieveRagMatches(index, 'connect to cassandra and run a query', 'java', 'ui');
  assert.ok(uiMatches.some((m) => m.id === 'connection-helper'), 'the same folder-name match should surface for UI Automation mode too');
});

test('a recipe is matchable purely by its own FILENAME segment', async () => {
  const namedRecipe = makeRecipe({
    id: 'oauth-token-refresh',
    title: 'Token utility',
    body: '```java\nTokenUtil.get();\n```',
    tags: [],
    relativePath: 'auth/oauth-token-refresh.md'
  });
  const index = await buildRagIndex([namedRecipe, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(index, 'refresh the oauth token before the request', 'java', 'api');
  assert.ok(matches.some((m) => m.id === 'oauth-token-refresh'), 'expected the filename words "oauth"/"token"/"refresh" alone to surface this recipe');
});

test('every match carries the recipe\'s own source file path, for traceability', async () => {
  const index = await buildRagIndex([POSTGRES_RECIPE, SCREENSHOT_RECIPE]);
  const matches = await retrieveRagMatches(
    index,
    'Login to Postgres database, query a specific table using a query, validate the result',
    'java',
    'api'
  );
  assert.equal(matches[0].filePath, '/fake/.github/rag/postgres-query-and-validate.md');
});

test('formatRagPromptSection returns an empty string for no matches (zero prompt cost)', () => {
  assert.equal(formatRagPromptSection([], 'java'), '');
});

test('formatRagPromptSection includes the title, body, and de-duplicated imports for the target language', () => {
  const section = formatRagPromptSection(
    [
      {
        id: 'a',
        title: 'Helper A',
        body: 'code A',
        imports: { java: ['com.acme.A', 'com.acme.Shared'] },
        score: 0.9,
        filePath: '/fake/.github/rag/a.md'
      },
      {
        id: 'b',
        title: 'Helper B',
        body: 'code B',
        imports: { java: ['com.acme.Shared'] },
        score: 0.5,
        filePath: '/fake/.github/rag/b.md'
      }
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
    [{ id: 'a', title: 'Helper A', body: 'code A', imports: { python: ['testutil.a'] }, score: 0.9, filePath: '/fake/.github/rag/a.md' }],
    'java'
  );
  assert.doesNotMatch(section, /testutil\.a/);
});

test('formatRagPromptSection truncates an unusually large recipe body rather than injecting it whole', () => {
  const hugeBody = 'x'.repeat(10_000);
  const section = formatRagPromptSection(
    [{ id: 'huge', title: 'Huge Helper', body: hugeBody, score: 0.9, filePath: '/fake/.github/rag/huge.md' }],
    'java'
  );
  assert.ok(section.length < hugeBody.length, 'the section should be meaningfully smaller than the raw oversized body');
  assert.match(section, /truncated/);
});

test('formatRagPromptSection leaves a normally-sized recipe body completely untouched', () => {
  const normalBody = '```java\nvar row = PostgresHelper.queryOne(conn, sql, id);\n```';
  const section = formatRagPromptSection(
    [{ id: 'a', title: 'Helper A', body: normalBody, score: 0.9, filePath: '/fake/.github/rag/a.md' }],
    'java'
  );
  assert.match(section, /PostgresHelper\.queryOne/);
  assert.doesNotMatch(section, /truncated/);
});

test('formatRagPromptSection shows just the source FILENAME (never the full local path) for each recipe', () => {
  const section = formatRagPromptSection(
    [{ id: 'postgres-query-and-validate', title: 'Helper', body: 'code', score: 0.9, filePath: '/Users/dev/project/.github/rag/postgres-query-and-validate.md' }],
    'java'
  );
  assert.match(section, /postgres-query-and-validate\.md/);
  assert.doesNotMatch(section, /\/Users\/dev\/project/);
});

test('formatRagPromptSection instructs the model to add a traceability comment referencing the id and source file', () => {
  const section = formatRagPromptSection(
    [{ id: 'postgres-query-and-validate', title: 'Helper', body: 'code', score: 0.9, filePath: '/fake/.github/rag/postgres-query-and-validate.md' }],
    'java'
  );
  assert.match(section, /RAG match:/);
  assert.match(section, /TRACEABILITY/i);
});
