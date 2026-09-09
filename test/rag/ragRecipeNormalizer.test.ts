import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeGeneratedRecipe, ragTargetRelPath } from '../../src/rag/ragRecipeNormalizer';
import { parseRagFile } from '../../src/rag/ragFrontmatter';

const WELL_FORMED_RESPONSE = `---
id: postgres-query-and-validate
title: Query a Postgres table and validate a result
tags: [postgres, database]
automationMode: [api]
language: [java]
---

Runs a parameterized query via the shared helper.

\`\`\`java
var row = PostgresHelper.queryOne(conn, sql, id);
\`\`\`
`;

test('a well-formed model response is accepted and re-serialized without a fallback', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE);
  assert.equal(result.usedFallback, false);
  const reparsed = parseRagFile(result.content);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.id, 'postgres-query-and-validate');
});

test('strips a single outer fence the model added despite instructions not to', () => {
  const wrapped = '```markdown\n' + WELL_FORMED_RESPONSE + '\n```';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', wrapped);
  assert.equal(result.usedFallback, false);
  const reparsed = parseRagFile(result.content);
  assert.equal(reparsed.ok, true);
});

test('falls back to a filename-derived frontmatter when the response has no frontmatter at all', () => {
  const result = normalizeGeneratedRecipe('My Postgres Helper.java', 'Just some prose with no frontmatter.');
  assert.equal(result.usedFallback, true);
  assert.ok(result.fallbackReason);
  const reparsed = parseRagFile(result.content);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  // Filename sanitized into a valid kebab-case id.
  assert.equal(reparsed.value.frontmatter.id, 'my-postgres-helper');
  assert.deepEqual(reparsed.value.frontmatter.language, ['java']);
});

test('falls back gracefully when the frontmatter is present but fails schema validation', () => {
  const malformed = '---\nid: NOT_VALID ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\nBody text.\n';
  const result = normalizeGeneratedRecipe('helper.py', malformed);
  assert.equal(result.usedFallback, true);
  const reparsed = parseRagFile(result.content);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.id, 'helper');
  assert.deepEqual(reparsed.value.frontmatter.language, ['python']);
});

test('an ambiguous file extension falls back to applying to both languages', () => {
  const result = normalizeGeneratedRecipe('config.yml', 'no frontmatter here');
  const reparsed = parseRagFile(result.content);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.value.frontmatter.language.slice().sort(), ['java', 'python']);
});

test('the fallback body preserves the full original response text (minus an outer fence)', () => {
  const responseWithNoFrontmatter = 'Here is a helper:\n\n```sql\nSELECT 1;\n```';
  const result = normalizeGeneratedRecipe('query.sql', responseWithNoFrontmatter);
  assert.equal(result.usedFallback, true);
  assert.match(result.content, /SELECT 1;/);
});

test('ragTargetRelPath with no relativePath saves directly under .github/rag, unchanged from before zip support', () => {
  assert.equal(ragTargetRelPath('PostgresHelper.java'), 'postgreshelper.md');
  assert.equal(ragTargetRelPath('PostgresHelper.java', ''), 'postgreshelper.md');
});

test('ragTargetRelPath mirrors a zip entry\'s original folder structure', () => {
  assert.equal(
    ragTargetRelPath('PostgresHelper.java', 'src/main/java/com/acme'),
    'src/main/java/com/acme/postgreshelper.md'
  );
});

test('ragTargetRelPath slugifies each folder segment, not just the filename', () => {
  assert.equal(ragTargetRelPath('Db.py', 'My Project/Db Utils'), 'my-project/db-utils/db.md');
});

test('ragTargetRelPath drops "." and ".." segments rather than traversing out of .github/rag', () => {
  assert.equal(ragTargetRelPath('Db.py', '../../etc/./passwd-ish'), 'etc/passwd-ish/db.md');
});

test('ragTargetRelPath keeps two same-named files from different folders from colliding', () => {
  const javaTarget = ragTargetRelPath('Helper.java', 'src/java');
  const pythonTarget = ragTargetRelPath('Helper.py', 'src/python');
  assert.notEqual(javaTarget, pythonTarget);
});
