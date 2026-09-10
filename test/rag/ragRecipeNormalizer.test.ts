import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { normalizeGeneratedRecipe, ragTargetRelPath, resolveRagTargets, RagTargetSource } from '../../src/rag/ragRecipeNormalizer';
import { parseRagFile } from '../../src/rag/ragFrontmatter';
import { extractCapabilities } from '../../src/rag/ragCapabilityExtraction';
import { SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES } from '../../src/rag/ragSourceIdentity';

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

test('a well-formed model response is ACCEPTED as-is (no repair needed)', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE);
  assert.equal(result.status, 'accepted');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.id, 'postgres-query-and-validate');
});

test('strips a single outer fence the model added despite instructions not to', () => {
  const wrapped = '```markdown\n' + WELL_FORMED_RESPONSE + '\n```';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', wrapped);
  assert.equal(result.status, 'accepted');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
});

test('an EMPTY response is REJECTED outright, never wrapped as a "recipe" with nothing in it', () => {
  const result = normalizeGeneratedRecipe('helper.java', '');
  assert.equal(result.status, 'rejected');
  assert.equal(result.content, undefined);
  assert.ok(result.reason);
});

test('a WHITESPACE-ONLY response is REJECTED, same as a truly empty one', () => {
  const result = normalizeGeneratedRecipe('helper.java', '   \n\t  \n  ');
  assert.equal(result.status, 'rejected');
  assert.equal(result.content, undefined);
});

test('an explicit "REVIEW NEEDED: <reason>" response is REJECTED with the model\'s own reason preserved', () => {
  const result = normalizeGeneratedRecipe('helper.java', 'REVIEW NEEDED: the excerpt never shows a return type for this method.');
  assert.equal(result.status, 'rejected');
  assert.equal(result.content, undefined);
  assert.match(result.reason!, /the excerpt never shows a return type/);
});

test('"REVIEW NEEDED" is recognized case-insensitively and across multiple lines', () => {
  const result = normalizeGeneratedRecipe('helper.java', 'review needed: ambiguous precondition\nnot enough evidence in the excerpt.');
  assert.equal(result.status, 'rejected');
  assert.match(result.reason!, /ambiguous precondition/);
});

test('refusal prose with no frontmatter and no callable content is REJECTED for a real source file — the bug this fixes', () => {
  // Before this fix, ANY non-parsing response — including plain refusal
  // prose with nothing callable in it — was wrapped wholesale as a
  // "broadly applicable" recipe (automationMode: [ui, api]) and indexed for
  // retrieval anyway, with only a soft "please review" warning that never
  // actually prevented it from being matched and injected into a prompt.
  const result = normalizeGeneratedRecipe('My Postgres Helper.java', "I'm sorry, but I don't have enough information to generate a recipe from this file.");
  assert.equal(result.status, 'rejected');
  assert.equal(result.content, undefined);
  assert.match(result.reason!, /no fenced code example/i);
});

test('a response with no frontmatter but a REAL fenced example for a concrete-language file is still repaired, not rejected', () => {
  const result = normalizeGeneratedRecipe('Helper.java', 'Here is a helper:\n\n```java\nHelper.call();\n```\n');
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.id, 'helper');
  assert.match(result.content!, /Helper\.call\(\)/);
});

test('schema-invalid frontmatter is repaired FIELD-BY-FIELD, preserving the model\'s own otherwise-valid values', () => {
  // Only `id` is actually broken here — repairing it should NOT throw away
  // the model's correct `title`/`automationMode`/`language` guesses (the
  // OLD behavior rebuilt frontmatter from scratch using only the filename
  // whenever ANY field failed, silently discarding real signal the model
  // got right).
  const malformed =
    '---\nid: NOT_VALID ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\n\nUses the shared helper.\n\n```java\nHelper.call();\n```\n';
  const result = normalizeGeneratedRecipe('helper.py', malformed);
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.id, 'helper'); // repaired via slugify(filename)
  assert.equal(reparsed.value.frontmatter.title, 'X'); // preserved — was already valid
  assert.deepEqual(reparsed.value.frontmatter.automationMode, ['ui']); // preserved — was already valid
  assert.deepEqual(reparsed.value.frontmatter.language, ['java']); // preserved (model's own value), NOT overridden to ['python'] from the .py extension
});

test('MALFORMED YAML (unparseable, not just schema-invalid) falls back to wrapping the whole response when it still has callable code', () => {
  const malformedYaml = '---\nid: [unclosed\ntitle: Helper\n---\n\nUses the helper.\n\n```java\nHelper.call();\n```\n';
  const result = normalizeGeneratedRecipe('helper.java', malformedYaml);
  assert.equal(result.status, 'repaired');
  assert.match(result.content!, /Helper\.call\(\)/);
});

// --- F02 (fallback compounding): capabilityName folded into repair/fallback id defaults ---

test('field-level repair\'s fallback id incorporates capabilityName, so two capabilities from the SAME file never repair to the identical id', () => {
  const malformedIdOnly = '---\nid: NOT_VALID ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\n\nDescription.\n\n```java\nHelper.call();\n```\n';
  const first = normalizeGeneratedRecipe('Helper.java', malformedIdOnly, undefined, undefined, 'findById');
  const second = normalizeGeneratedRecipe('Helper.java', malformedIdOnly, undefined, undefined, 'findByName');
  const firstId = parseRagFile(first.content!);
  const secondId = parseRagFile(second.content!);
  assert.equal(firstId.ok && firstId.value.frontmatter.id, 'helper-findbyid');
  assert.equal(secondId.ok && secondId.value.frontmatter.id, 'helper-findbyname');
});

test('the last-resort fallback-wrap id ALSO incorporates capabilityName, for the same reason', () => {
  const refusalProse = 'I cannot generate this.';
  const first = normalizeGeneratedRecipe('Helper.java', `${refusalProse}\n\n\`\`\`java\nHelper.callOne();\n\`\`\``, undefined, undefined, 'callOne');
  const second = normalizeGeneratedRecipe('Helper.java', `${refusalProse}\n\n\`\`\`java\nHelper.callTwo();\n\`\`\``, undefined, undefined, 'callTwo');
  const firstParsed = parseRagFile(first.content!);
  const secondParsed = parseRagFile(second.content!);
  assert.equal(first.status, 'repaired');
  assert.equal(second.status, 'repaired');
  assert.equal(firstParsed.ok && firstParsed.value.frontmatter.id, 'helper-callone');
  assert.equal(secondParsed.ok && secondParsed.value.frontmatter.id, 'helper-calltwo');
  assert.notEqual(firstParsed.ok && firstParsed.value.frontmatter.id, secondParsed.ok && secondParsed.value.frontmatter.id);
});

test('with NO capabilityName given, the fallback id behaves exactly as before (backward compatible)', () => {
  const refusalProse = 'I cannot generate this.\n\n```java\nHelper.call();\n```';
  const result = normalizeGeneratedRecipe('Helper.java', refusalProse);
  const parsed = parseRagFile(result.content!);
  assert.equal(parsed.ok && parsed.value.frontmatter.id, 'helper');
});

test('valid frontmatter with an EMPTY body is REJECTED, not silently accepted as a contentless recipe', () => {
  const emptyBodyResponse = '---\nid: helper\ntitle: Helper\nautomationMode: [ui]\nlanguage: [java]\n---\n\n   \n';
  const result = normalizeGeneratedRecipe('helper.java', emptyBodyResponse);
  assert.equal(result.status, 'rejected');
  assert.equal(result.content, undefined);
});

test('an ambiguous (config-type) file extension does not require a fenced code example — real prose is enough', () => {
  const result = normalizeGeneratedRecipe('config.yml', 'Set FEATURE_FLAG=true in this file to enable the new checkout flow.');
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.deepEqual(reparsed.value.frontmatter.language.slice().sort(), ['java', 'python']);
});

test('an ambiguous (config-type) file with NO usable content at all is still rejected', () => {
  const result = normalizeGeneratedRecipe('config.yml', '   ');
  assert.equal(result.status, 'rejected');
});

test('normalizeGeneratedRecipe stamps sourcePath from the upload\'s own relativePath, for an ACCEPTED response', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme');
  assert.equal(result.status, 'accepted');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourcePath, 'src/main/java/com/acme/PostgresHelper.java');
});

test('normalizeGeneratedRecipe OVERWRITES a sourcePath the model itself hallucinated, never trusting it', () => {
  const modelClaimedWrongPath = WELL_FORMED_RESPONSE.replace(
    'language: [java]',
    'language: [java]\nsourcePath: some/made-up/path/Elsewhere.java'
  );
  const result = normalizeGeneratedRecipe('PostgresHelper.java', modelClaimedWrongPath, 'src/main/java/com/acme');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourcePath, 'src/main/java/com/acme/PostgresHelper.java');
});

test('normalizeGeneratedRecipe stamps sourcePath with just the filename when there is no relativePath (a directly-dropped file)', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourcePath, 'PostgresHelper.java');
});

test('normalizeGeneratedRecipe stamps sourcePath on a REPAIRED (field-level fix) result too', () => {
  const malformed =
    '---\nid: NOT_VALID ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\n\nUses the shared helper.\n\n```java\nHelper.call();\n```\n';
  const result = normalizeGeneratedRecipe('helper.py', malformed, 'framework/db');
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourcePath, 'framework/db/helper.py');
});

test('normalizeGeneratedRecipe stamps sourcePath on the last-resort fallback-wrap result too', () => {
  const result = normalizeGeneratedRecipe('Helper.java', 'Here is a helper:\n\n```java\nHelper.call();\n```\n', 'src/main/java');
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourcePath, 'src/main/java/Helper.java');
});

// --- A07: sourceMapped is stamped from the caller's own resolution, exactly
// like sourcePath/sourceHash/sourceHashScheme ---------------------------

test('normalizeGeneratedRecipe stamps sourceMapped: true when the caller confirms it, for an ACCEPTED response', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', undefined, undefined, undefined, true);
  assert.equal(result.status, 'accepted');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, true);
});

test('normalizeGeneratedRecipe stamps sourceMapped: false when the caller could not confirm it — never omitted or defaulted to true', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', undefined, undefined, undefined, false);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, false);
});

test('normalizeGeneratedRecipe leaves sourceMapped undefined when the caller does not pass it at all (backward compatible)', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, undefined);
});

test('normalizeGeneratedRecipe OVERWRITES a sourceMapped value the model itself hallucinated, never trusting it', () => {
  const modelClaimedMapped = WELL_FORMED_RESPONSE.replace('language: [java]', 'language: [java]\nsourceMapped: true');
  const result = normalizeGeneratedRecipe('PostgresHelper.java', modelClaimedMapped, 'src/main/java/com/acme', undefined, undefined, undefined, false);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, false, 'the extension\'s own resolution result must win, never the model\'s own claim');
});

test('normalizeGeneratedRecipe stamps sourceMapped on a REPAIRED (field-level fix) result too', () => {
  const malformed =
    '---\nid: NOT_VALID ID\ntitle: X\nautomationMode: [ui]\nlanguage: [java]\n---\n\nUses the shared helper.\n\n```java\nHelper.call();\n```\n';
  const result = normalizeGeneratedRecipe('helper.py', malformed, 'framework/db', undefined, undefined, undefined, false);
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, false);
});

test('normalizeGeneratedRecipe stamps sourceMapped on the last-resort fallback-wrap result too', () => {
  const result = normalizeGeneratedRecipe('Helper.java', 'Here is a helper:\n\n```java\nHelper.call();\n```\n', 'src/main/java', undefined, undefined, undefined, false);
  assert.equal(result.status, 'repaired');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceMapped, false);
});

test('normalizeGeneratedRecipe stamps sourceHash (SHA-256 of the ORIGINAL source content) when it is given', () => {
  const originalSourceContent = 'public class PostgresHelper { void queryOne() {} }';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', originalSourceContent);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.match(reparsed.value.frontmatter.sourceHash ?? '', /^[0-9a-f]{64}$/);
});

test('normalizeGeneratedRecipe leaves sourceHash undefined when no source content is given (no false provenance claim)', () => {
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme');
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceHash, undefined);
});

test('normalizeGeneratedRecipe OVERWRITES a sourceHash the model itself hallucinated, never trusting it', () => {
  const modelClaimedWrongHash = WELL_FORMED_RESPONSE.replace('language: [java]', 'language: [java]\nsourceHash: ' + 'f'.repeat(64));
  const originalSourceContent = 'public class PostgresHelper { void queryOne() {} }';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', modelClaimedWrongHash, undefined, originalSourceContent);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.notEqual(reparsed.value.frontmatter.sourceHash, 'f'.repeat(64));
});

// --- F09: sourceHashScheme is stamped alongside sourceHash -------------------

test('normalizeGeneratedRecipe stamps the given sourceHashScheme alongside sourceHash', () => {
  const originalSourceContent = 'public class PostgresHelper { void queryOne() {} }';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', originalSourceContent, undefined, SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceHashScheme, SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES);
});

test('normalizeGeneratedRecipe leaves sourceHashScheme undefined when no scheme is given (backward compatible — absence means LEGACY to any reader)', () => {
  const originalSourceContent = 'public class PostgresHelper { void queryOne() {} }';
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', originalSourceContent);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceHashScheme, undefined);
});

test('normalizeGeneratedRecipe never stamps a sourceHashScheme when there is no sourceHash to pair it with', () => {
  // No sourceRawContent given at all — a scheme label with no hash to
  // describe would be misleading, so it must never appear on its own.
  const result = normalizeGeneratedRecipe('PostgresHelper.java', WELL_FORMED_RESPONSE, 'src/main/java/com/acme', undefined, undefined, SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES);
  const reparsed = parseRagFile(result.content!);
  assert.equal(reparsed.ok, true);
  if (!reparsed.ok) return;
  assert.equal(reparsed.value.frontmatter.sourceHash, undefined);
  assert.equal(reparsed.value.frontmatter.sourceHashScheme, undefined);
});

test('the fallback body preserves the full original response text (minus an outer fence)', () => {
  const responseWithNoFrontmatter = 'Here is a helper:\n\n```sql\nSELECT 1;\n```';
  const result = normalizeGeneratedRecipe('query.sql', responseWithNoFrontmatter);
  assert.equal(result.status, 'repaired');
  assert.match(result.content!, /SELECT 1;/);
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

function src(fileName: string, relativePath?: string, content = 'content', capabilityName?: string): RagTargetSource {
  return { fileName, relativePath, content, capabilityName };
}

test('resolveRagTargets: same basename, different extensions, same folder — disambiguated by extension', () => {
  const [java, python] = resolveRagTargets([src('helper.java', 'src'), src('helper.py', 'src')]);
  assert.equal(java.status, 'unique');
  assert.equal(python.status, 'unique');
  assert.notEqual(java.targetRelPath, python.targetRelPath);
  assert.equal(java.targetRelPath, 'src/helper-java.md');
  assert.equal(python.targetRelPath, 'src/helper-py.md');
});

test('resolveRagTargets: slug collision with the SAME extension falls back to a stable hash suffix', () => {
  const files = [src('foo_bar.py', 'src'), src('foo-bar.py', 'src')];
  const [a, b] = resolveRagTargets(files);
  assert.equal(a.status, 'unique');
  assert.equal(b.status, 'unique');
  assert.notEqual(a.targetRelPath, b.targetRelPath);
  // Extension can't disambiguate here (both .py) — falls back to a hash, not the raw extension.
  assert.doesNotMatch(a.targetRelPath, /foo-bar-py\.md$/);
  // Stable: re-running resolution on the same inputs (in either order) yields the same targets.
  const [aAgain, bAgain] = resolveRagTargets(files);
  assert.equal(a.targetRelPath, aAgain.targetRelPath);
  assert.equal(b.targetRelPath, bAgain.targetRelPath);
  const [bFirst, aFirst] = resolveRagTargets([files[1], files[0]]);
  assert.equal(aFirst.targetRelPath, a.targetRelPath);
  assert.equal(bFirst.targetRelPath, b.targetRelPath);
});

test('resolveRagTargets: an identical duplicate upload (same name, path, and content) is flagged as a duplicate, not overwritten', () => {
  const files = [src('helper.py', 'src', 'same content'), src('helper.py', 'src', 'same content')];
  const [first, second] = resolveRagTargets(files);
  assert.equal(first.status, 'unique');
  assert.equal(second.status, 'duplicate');
  assert.equal(second.matchesIndex, 0);
  assert.equal(second.targetRelPath, first.targetRelPath);
});

test('resolveRagTargets: same name and path but DIFFERENT content is a conflict, never silently resolved', () => {
  const files = [src('helper.py', 'src', 'version A'), src('helper.py', 'src', 'version B')];
  const [first, second] = resolveRagTargets(files);
  assert.equal(first.status, 'unique');
  assert.equal(second.status, 'conflict');
  assert.equal(second.matchesIndex, 0);
});

test('resolveRagTargets: same basename in different directories never collide', () => {
  const [a, b] = resolveRagTargets([src('helper.py', 'src/one'), src('helper.py', 'src/two')]);
  assert.equal(a.status, 'unique');
  assert.equal(b.status, 'unique');
  assert.notEqual(a.targetRelPath, b.targetRelPath);
});

test('resolveRagTargets: collision detection is case-insensitive (case-insensitive filesystems)', () => {
  const [a, b] = resolveRagTargets([src('Helper.PY', 'SRC'), src('helper.py', 'src')]);
  assert.equal(a.status, 'unique');
  // Different casing of the same content/path still counts as the same identity/content.
  assert.equal(b.status, 'duplicate');
});

test('resolveRagTargets: three-way collision (2 share an extension, 1 unique) all fall back to hashes for consistency', () => {
  const files = [src('foo_bar.py', 'src'), src('foo-bar.py', 'src'), src('foo-bar.java', 'src')];
  const results = resolveRagTargets(files);
  assert.ok(results.every((r) => r.status === 'unique'));
  const targets = results.map((r) => r.targetRelPath);
  assert.equal(new Set(targets).size, 3);
});

test('resolveRagTargets: every distinct source keeps its own output — count matches actual unique outputs', () => {
  const files = [
    src('helper.java', 'src', 'a'),
    src('helper.py', 'src', 'b'),
    src('helper.py', 'src', 'b'), // duplicate of the above
    src('helper.py', 'other', 'c'), // different folder
    src('foo.py', 'src', 'd')
  ];
  const results = resolveRagTargets(files);
  const written = results.filter((r) => r.status === 'unique');
  assert.equal(written.length, 4);
  assert.equal(new Set(written.map((r) => r.targetRelPath)).size, 4);
  assert.equal(results[2].status, 'duplicate');
});

test('ragTargetRelPath appends the capability name when given, distinguishing it from the whole-file target', () => {
  const wholeFile = ragTargetRelPath('PostgresHelper.java', 'src/main/java/com/acme');
  const capability = ragTargetRelPath('PostgresHelper.java', 'src/main/java/com/acme', 'queryOne');
  assert.notEqual(wholeFile, capability);
  assert.equal(capability, 'src/main/java/com/acme/postgreshelper-queryone.md');
});

test('resolveRagTargets: two DIFFERENT capabilities from the SAME file are distinct sources, never duplicate/conflict', () => {
  const files = [
    src('PostgresHelper.java', 'src', 'shared file content', 'queryOne'),
    src('PostgresHelper.java', 'src', 'shared file content', 'close')
  ];
  const results = resolveRagTargets(files);
  assert.equal(results[0].status, 'unique');
  assert.equal(results[1].status, 'unique');
  assert.notEqual(results[0].targetRelPath, results[1].targetRelPath);
});

test('resolveRagTargets: the SAME capability re-processed with identical content is still flagged a duplicate', () => {
  const files = [
    src('PostgresHelper.java', 'src', 'same excerpt', 'queryOne'),
    src('PostgresHelper.java', 'src', 'same excerpt', 'queryOne')
  ];
  const results = resolveRagTargets(files);
  assert.equal(results[0].status, 'unique');
  assert.equal(results[1].status, 'duplicate');
});

test('resolveRagTargets: a whole-file source and a capability source from the same file never collide', () => {
  const files = [src('PostgresHelper.java', 'src', 'a'), src('PostgresHelper.java', 'src', 'b', 'queryOne')];
  const results = resolveRagTargets(files);
  assert.equal(results[0].status, 'unique');
  assert.equal(results[1].status, 'unique');
  assert.notEqual(results[0].targetRelPath, results[1].targetRelPath);
});

// --- F01: cross-group (residual) collision fixup -----------------------------

test('resolveRagTargets: a disambiguated name from one collision group never collides with an unrelated file\'s own natural name (the reproduced F01 bug)', () => {
  // helper.java + helper.py collide on "helper" and disambiguate to
  // helper-java.md/helper-py.md via the extension suffix. A THIRD,
  // unrelated file literally named helper-java.java naturally resolves to
  // that exact same helper-java.md on its own — a collision invisible to
  // per-group disambiguation, since the two groups never overlap.
  const files = [src('helper.java', undefined), src('helper.py', undefined), src('helper-java.java', undefined)];
  const results = resolveRagTargets(files);
  const paths = results.map((r) => r.targetRelPath.toLowerCase());
  assert.equal(new Set(paths).size, 3, `expected 3 distinct target paths, got: ${paths.join(', ')}`);
  // None of the three may be silently marked as conflicting with each
  // other (they're all genuinely different, unrelated sources) — every one
  // must resolve as its own 'unique' result.
  assert.ok(results.every((r) => r.status === 'unique'));
});

test('resolveRagTargets: the residual-collision fixup never touches an unrelated, non-colliding file', () => {
  const files = [src('helper.java', undefined), src('helper.py', undefined), src('helper-java.java', undefined), src('totally-unrelated.py', undefined)];
  const results = resolveRagTargets(files);
  assert.equal(results[3].targetRelPath, 'totally-unrelated.md');
});

test('resolveRagTargets: residual collision fixup is deterministic regardless of input order', () => {
  const filesA = [src('helper.java', undefined), src('helper.py', undefined), src('helper-java.java', undefined)];
  const filesB = [filesA[2], filesA[0], filesA[1]];
  const resultsA = resolveRagTargets(filesA);
  const resultsB = resolveRagTargets(filesB);
  const pathFor = (results: ReturnType<typeof resolveRagTargets>, files: RagTargetSource[], fileName: string) => {
    const i = files.findIndex((f) => f.fileName === fileName);
    return results[i].targetRelPath.toLowerCase();
  };
  for (const name of ['helper.java', 'helper.py', 'helper-java.java']) {
    assert.equal(pathFor(resultsA, filesA, name), pathFor(resultsB, filesB, name));
  }
});

// --- F01: stable paths across batches via existingTargetsByIdentity ---------

test('resolveRagTargets: a source already represented in the corpus reuses its EXISTING target path rather than deriving a fresh one', () => {
  const files = [src('helper.java', undefined)];
  const existing = new Map([['helper.java', 'helper-java.md']]); // as if a prior batch (with helper.py alongside) had assigned this
  const results = resolveRagTargets(files, existing);
  assert.equal(results[0].targetRelPath, 'helper-java.md');
  assert.equal(results[0].status, 'unique');
});

test('resolveRagTargets: re-uploading a SUBSET of a prior batch reliably replaces the prior output instead of creating an orphaned duplicate', () => {
  // Simulates: batch 1 was [helper.java, helper.py] -> disambiguated to
  // helper-java.md / helper-py.md. Batch 2 re-uploads ONLY helper.java.
  // Without existingTargetsByIdentity, batch 2 alone would have no
  // collision and would derive the DIFFERENT name "helper.md" — leaving
  // "helper-java.md" as a stale orphan. With it, batch 2 must reuse the
  // exact same "helper-java.md" the first batch assigned.
  const batch2Files = [src('helper.java', undefined)];
  const existingFromBatch1 = new Map([['helper.java', 'helper-java.md']]);
  const batch2Results = resolveRagTargets(batch2Files, existingFromBatch1);
  assert.equal(batch2Results[0].targetRelPath, 'helper-java.md');
});

test('resolveRagTargets: existingTargetsByIdentity has no effect on a source it doesn\'t recognize', () => {
  const files = [src('brand-new.java', undefined)];
  const existing = new Map([['some-other-file.java', 'some-other-file.md']]);
  const results = resolveRagTargets(files, existing);
  assert.equal(results[0].targetRelPath, 'brand-new.md');
});

test('resolveRagTargets: an existing-path match is matched case-insensitively', () => {
  const files = [src('Helper.java', undefined)];
  const existing = new Map([['helper.java', 'helper-java.md']]); // lowercased key, as buildExistingTargetsByIdentity() produces
  const results = resolveRagTargets(files, existing);
  assert.equal(results[0].targetRelPath, 'helper-java.md');
});

test('resolveRagTargets: a NEW source colliding with an EXISTING corpus path yields to it, never overwriting the existing one silently', () => {
  const files = [src('newcomer.java', undefined)];
  // "newcomer.java" naturally slugifies to "newcomer.md", which some
  // EXISTING (unrelated) recipe already occupies.
  const existing = new Map([['someone-elses-source.java', 'newcomer.md']]);
  const results = resolveRagTargets(files, existing);
  assert.notEqual(results[0].targetRelPath.toLowerCase(), 'newcomer.md');
});

// --- F02 end-to-end: overloaded methods generate as distinct, non-conflicting recipes ---

test('end-to-end: a class with find(int)/find(String) overloads resolves to TWO distinct target paths, never a spurious conflict (the reproduced F02 bug)', () => {
  const overloaded = `public class Finder {
  public Row find(int id) {
    return byId(id);
  }

  public Row find(String name) {
    return byName(name);
  }
}
`;
  const caps = extractCapabilities('Finder.java', overloaded);
  assert.equal(caps.length, 2);
  const targetSources = caps.map((cap) => src('Finder.java', 'src/db', cap.excerpt, cap.namingId ?? cap.name));
  const results = resolveRagTargets(targetSources);
  assert.equal(results[0].status, 'unique');
  assert.equal(results[1].status, 'unique');
  assert.notEqual(results[0].targetRelPath, results[1].targetRelPath);
});

// --- A05 end-to-end: same bare name, DIFFERENT owners, one file — both
// capabilities generate as distinct, non-conflicting recipes -------------

test('end-to-end: two DIFFERENT classes in the SAME file that both declare run() resolve to TWO distinct target paths, never a spurious conflict (the reproduced A05 bug)', () => {
  const twoOwners = `class A:
    def run(self):
        return 1


class B:
    def run(self):
        return 2
`;
  const caps = extractCapabilities('multi.py', twoOwners);
  assert.equal(caps.length, 2);
  assert.notEqual(caps[0].ownerClassName, caps[1].ownerClassName);
  assert.ok(caps[0].namingId, 'A05 fix: a bare-name collision across DIFFERENT owners must still get a namingId');
  assert.ok(caps[1].namingId);
  assert.notEqual(caps[0].namingId, caps[1].namingId);

  const targetSources = caps.map((cap) => src('multi.py', 'src', cap.excerpt, cap.namingId ?? cap.name));
  const results = resolveRagTargets(targetSources);
  assert.equal(results[0].status, 'unique');
  assert.equal(results[1].status, 'unique');
  assert.notEqual(results[0].targetRelPath, results[1].targetRelPath);
});
