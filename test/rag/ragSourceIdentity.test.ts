import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import {
  buildSourceIdentity,
  extractJavaPackageDeclaration,
  hashSourceContent,
  stripCapabilitySuffix,
  resolveSafeRelativePath,
  validateSafeRelativeSegments,
  isKnownSourceHashScheme,
  SOURCE_HASH_SCHEME_LEGACY,
  SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES,
  buildDependencyAwareCanonicalContent,
  computeDependencyAwareSourceHash,
  selectSourceHashInput,
  isPathContained
} from '../../src/rag/ragSourceIdentity';
import { extractCapabilities, extractAllCallableUnitsForDependencyDiscovery } from '../../src/rag/ragCapabilityExtraction';
import type { ExtractedCapability } from '../../src/rag/ragCapabilityExtraction';

test('buildSourceIdentity joins relativePath and fileName for a nested upload', () => {
  assert.equal(buildSourceIdentity('PostgresHelper.java', 'src/main/java/com/acme'), 'src/main/java/com/acme/PostgresHelper.java');
});

test('buildSourceIdentity returns just the filename for a directly-dropped file with no folder context', () => {
  assert.equal(buildSourceIdentity('PostgresHelper.java', undefined), 'PostgresHelper.java');
  assert.equal(buildSourceIdentity('PostgresHelper.java', ''), 'PostgresHelper.java');
});

test('buildSourceIdentity trims stray leading/trailing slashes on relativePath', () => {
  assert.equal(buildSourceIdentity('client.py', '/framework/db/'), 'framework/db/client.py');
});

test('buildSourceIdentity appends a "#capabilityName" suffix when a capability is given', () => {
  assert.equal(
    buildSourceIdentity('PostgresHelper.java', 'src/main/java/com/acme', 'queryOne'),
    'src/main/java/com/acme/PostgresHelper.java#queryOne'
  );
});

test('buildSourceIdentity omits the "#" suffix entirely when no capability is given', () => {
  assert.equal(buildSourceIdentity('PostgresHelper.java', 'src'), 'src/PostgresHelper.java');
});

test('extractJavaPackageDeclaration finds a standard package statement', () => {
  const content = 'package com.acme.testutil.db;\n\nimport java.sql.Connection;\n\npublic class PostgresHelper {}\n';
  assert.equal(extractJavaPackageDeclaration(content), 'com.acme.testutil.db');
});

test('extractJavaPackageDeclaration tolerates leading whitespace and extra spacing around dots', () => {
  const content = '  package  com . acme . db ;\npublic class X {}\n';
  assert.equal(extractJavaPackageDeclaration(content), 'com.acme.db');
});

test('extractJavaPackageDeclaration returns undefined for a file with no package statement (default package)', () => {
  assert.equal(extractJavaPackageDeclaration('public class Standalone {}\n'), undefined);
});

test('extractJavaPackageDeclaration returns undefined for non-Java content', () => {
  assert.equal(extractJavaPackageDeclaration('def helper():\n    pass\n'), undefined);
});

test('extractJavaPackageDeclaration does not match "package" appearing inside a comment or string, only a real statement', () => {
  // A real statement must start the line (ignoring leading whitespace) —
  // "package" mentioned mid-sentence in a comment shouldn't match.
  const content = '// see package com.other.thing for reference\npublic class X {}\n';
  assert.equal(extractJavaPackageDeclaration(content), undefined);
});

test('hashSourceContent is deterministic — the same content always hashes the same', () => {
  const content = 'public class Foo { void bar() {} }';
  assert.equal(hashSourceContent(content), hashSourceContent(content));
});

test('hashSourceContent produces a 64-char lowercase hex SHA-256 digest', () => {
  const hash = hashSourceContent('anything');
  assert.match(hash, /^[0-9a-f]{64}$/);
});

test('hashSourceContent is sensitive to even a one-character change', () => {
  assert.notEqual(hashSourceContent('public class Foo {}'), hashSourceContent('public class Fooo {}'));
});

test('hashSourceContent of empty content is still a valid, stable digest', () => {
  const hash = hashSourceContent('');
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, hashSourceContent(''));
});

// --- stripCapabilitySuffix ----------------------------------------------

test('stripCapabilitySuffix removes a "#capabilityName" suffix', () => {
  assert.equal(stripCapabilitySuffix('src/db/CsqlHelper.java#queryOne'), 'src/db/CsqlHelper.java');
});

test('stripCapabilitySuffix leaves a whole-file sourcePath (no "#") unchanged', () => {
  assert.equal(stripCapabilitySuffix('src/db/CsqlHelper.java'), 'src/db/CsqlHelper.java');
});

test('stripCapabilitySuffix and buildSourceIdentity are exact inverses for the path portion', () => {
  const identity = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  assert.equal(stripCapabilitySuffix(identity), 'src/db/CsqlHelper.java');
});

// --- resolveSafeRelativePath (path-traversal protection) -----------------

test('resolveSafeRelativePath joins a normal relative path under the root', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(resolveSafeRelativePath(root, 'src/main/java/Foo.java'), path.join(root, 'src', 'main', 'java', 'Foo.java'));
});

test('resolveSafeRelativePath accepts backslash-separated segments the same way as forward slashes', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(resolveSafeRelativePath(root, 'src\\main\\Foo.java'), path.join(root, 'src', 'main', 'Foo.java'));
});

test('resolveSafeRelativePath ignores harmless "." segments', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(resolveSafeRelativePath(root, './src/./Foo.java'), path.join(root, 'src', 'Foo.java'));
});

test('resolveSafeRelativePath refuses a POSIX-absolute path', () => {
  assert.equal(resolveSafeRelativePath(path.join('workspace'), '/etc/passwd'), undefined);
});

test('resolveSafeRelativePath refuses a Windows drive-letter absolute path', () => {
  assert.equal(resolveSafeRelativePath(path.join('workspace'), 'C:\\Windows\\System32\\config'), undefined);
});

test('resolveSafeRelativePath refuses ANY ".." traversal segment, even one that would net out inside the root', () => {
  assert.equal(resolveSafeRelativePath(path.join('workspace', 'proj'), '../proj/src/Foo.java'), undefined);
  assert.equal(resolveSafeRelativePath(path.join('workspace', 'proj'), 'src/../../../../etc/passwd'), undefined);
});

test('resolveSafeRelativePath refuses an empty, whitespace-only, or all-dot-segment path', () => {
  assert.equal(resolveSafeRelativePath(path.join('workspace'), ''), undefined);
  assert.equal(resolveSafeRelativePath(path.join('workspace'), '   '), undefined);
  assert.equal(resolveSafeRelativePath(path.join('workspace'), '.'), undefined);
});

test('resolveSafeRelativePath is a pure, deterministic function of its inputs', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(resolveSafeRelativePath(root, 'a/b/c.java'), resolveSafeRelativePath(root, 'a/b/c.java'));
});

// --- validateSafeRelativeSegments (F09: scheme-agnostic path safety) -------

test('validateSafeRelativeSegments splits a normal relative path into its segments', () => {
  assert.deepEqual(validateSafeRelativeSegments('src/main/java/Foo.java'), ['src', 'main', 'java', 'Foo.java']);
});

test('validateSafeRelativeSegments accepts backslash-separated segments the same way as forward slashes', () => {
  assert.deepEqual(validateSafeRelativeSegments('src\\main\\Foo.java'), ['src', 'main', 'Foo.java']);
});

test('validateSafeRelativeSegments ignores harmless "." segments', () => {
  assert.deepEqual(validateSafeRelativeSegments('./src/./Foo.java'), ['src', 'Foo.java']);
});

test('validateSafeRelativeSegments refuses a POSIX-absolute path', () => {
  assert.equal(validateSafeRelativeSegments('/etc/passwd'), undefined);
});

test('validateSafeRelativeSegments refuses a Windows drive-letter absolute path', () => {
  assert.equal(validateSafeRelativeSegments('C:\\Windows\\System32\\config'), undefined);
});

test('validateSafeRelativeSegments refuses ANY ".." traversal segment', () => {
  assert.equal(validateSafeRelativeSegments('../proj/src/Foo.java'), undefined);
  assert.equal(validateSafeRelativeSegments('src/../../../../etc/passwd'), undefined);
});

test('validateSafeRelativeSegments refuses an empty, whitespace-only, or all-dot-segment path', () => {
  assert.equal(validateSafeRelativeSegments(''), undefined);
  assert.equal(validateSafeRelativeSegments('   '), undefined);
  assert.equal(validateSafeRelativeSegments('.'), undefined);
});

test('validateSafeRelativeSegments never produces a segment containing a path separator (so joinPath can never be tricked)', () => {
  const segments = validateSafeRelativeSegments('a/b/c.java')!;
  for (const segment of segments) {
    assert.doesNotMatch(segment, /[\\/]/);
  }
});

test('resolveSafeRelativePath and validateSafeRelativeSegments agree on what is safe', () => {
  const root = path.join('workspace', 'proj');
  const cases = ['a/b/c.java', '../escape', '/absolute', 'C:\\drive', '', '.'];
  for (const relPath of cases) {
    const viaPath = resolveSafeRelativePath(root, relPath);
    const viaSegments = validateSafeRelativeSegments(relPath);
    assert.equal(viaPath === undefined, viaSegments === undefined, `disagreement on: ${JSON.stringify(relPath)}`);
  }
});

// --- F09: dependency-aware hashing + a persisted hash-scheme version --------

function cap(overrides: Partial<ExtractedCapability> & Pick<ExtractedCapability, 'name' | 'excerpt'>): ExtractedCapability {
  return { kind: 'method', ownerClassName: 'Finder', signature: `public Row ${overrides.name}(int id)`, ...overrides };
}

test('isKnownSourceHashScheme recognizes both known schemes', () => {
  assert.equal(isKnownSourceHashScheme(SOURCE_HASH_SCHEME_LEGACY), true);
  assert.equal(isKnownSourceHashScheme(SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES), true);
});

test('isKnownSourceHashScheme rejects an unrecognized (e.g. future) scheme string', () => {
  assert.equal(isKnownSourceHashScheme('sha256-some-future-scheme-v2'), false);
});

test('buildDependencyAwareCanonicalContent includes just the capability\'s own excerpt when it has no same-file dependencies', () => {
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return byId(id); }' });
  assert.equal(buildDependencyAwareCanonicalContent(find, [find]), find.excerpt);
});

test('buildDependencyAwareCanonicalContent includes a DIRECT same-file dependency\'s excerpt', () => {
  const helper = cap({ name: 'lookupRow', excerpt: 'private Row lookupRow(int id) { return db.get(id); }' });
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return lookupRow(id); }' });
  const canonical = buildDependencyAwareCanonicalContent(find, [find, helper]);
  assert.match(canonical, /return lookupRow\(id\)/);
  assert.match(canonical, /return db\.get\(id\)/);
});

test('buildDependencyAwareCanonicalContent follows TRANSITIVE dependencies (A calls B calls C)', () => {
  const c = cap({ name: 'rawQuery', excerpt: 'private Row rawQuery(int id) { return sql.exec(id); }' });
  const b = cap({ name: 'lookupRow', excerpt: 'private Row lookupRow(int id) { return rawQuery(id); }' });
  const a = cap({ name: 'find', excerpt: 'public Row find(int id) { return lookupRow(id); }' });
  const canonical = buildDependencyAwareCanonicalContent(a, [a, b, c]);
  assert.match(canonical, /rawQuery\(id\)/);
  assert.match(canonical, /sql\.exec\(id\)/);
});

test('buildDependencyAwareCanonicalContent is cycle-safe for mutual recursion (A calls B, B calls A) and never includes the root as its own dependency twice', () => {
  const a: ExtractedCapability = cap({ name: 'isEven', excerpt: 'public boolean isEven(int n) { return n == 0 || isOdd(n - 1); }' });
  const b: ExtractedCapability = cap({ name: 'isOdd', excerpt: 'public boolean isOdd(int n) { return n != 0 && isEven(n - 1); }' });
  // Must terminate (no infinite loop) and include "isOdd" exactly once.
  const canonical = buildDependencyAwareCanonicalContent(a, [a, b]);
  const occurrences = canonical.split('isOdd(n - 1)').length - 1;
  assert.equal(occurrences, 1);
});

test('buildDependencyAwareCanonicalContent never treats a "whole-file" entry as a dependency', () => {
  const wholeFile = cap({ name: 'Helper', kind: 'whole-file', excerpt: 'entire file content here, mentions find(x) in a comment' });
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return byId(id); }' });
  const canonical = buildDependencyAwareCanonicalContent(find, [find, wholeFile]);
  assert.doesNotMatch(canonical, /entire file content/);
});

test('buildDependencyAwareCanonicalContent is deterministic regardless of the input array\'s own order', () => {
  const helperA = cap({ name: 'lookupA', excerpt: 'private Row lookupA() { return null; }' });
  const helperB = cap({ name: 'lookupB', excerpt: 'private Row lookupB() { return null; }' });
  const find = cap({ name: 'find', excerpt: 'public Row find() { lookupA(); lookupB(); return null; }' });
  const forward = buildDependencyAwareCanonicalContent(find, [find, helperA, helperB]);
  const reversed = buildDependencyAwareCanonicalContent(find, [helperB, helperA, find]);
  assert.equal(forward, reversed);
});

test('buildDependencyAwareCanonicalContent includes EVERY same-named overload as a best-effort dependency when it can\'t tell which one is actually called', () => {
  // A09: real Java overloads always have DISTINCT signatures (identical
  // signatures on the same owner would be a compile error) — this fixture
  // sets `overloadB`'s signature explicitly (rather than relying on
  // `cap()`'s shared default) so the two overloads are structurally
  // distinguishable by `findAllSameFileDependencies()`'s own
  // (owner, name, signature) identity key, exactly as any two REAL
  // overloads always would be.
  const overloadA = cap({ name: 'find', namingId: 'find-aaa111', excerpt: 'public Row find(int id) { return byId(id); }' });
  const overloadB = cap({ name: 'find', namingId: 'find-bbb222', signature: 'public Row find(String name)', excerpt: 'public Row find(String name) { return byName(name); }' });
  const caller = cap({ name: 'locate', excerpt: 'public Row locate(Object key) { return find(key); }' });
  const canonical = buildDependencyAwareCanonicalContent(caller, [caller, overloadA, overloadB]);
  assert.match(canonical, /byId\(id\)/);
  assert.match(canonical, /byName\(name\)/);
});

test('computeDependencyAwareSourceHash changes when a same-file DEPENDENCY changes, even though the capability\'s OWN excerpt is untouched (the F09 gap this closes)', () => {
  const helperV1 = cap({ name: 'lookupRow', excerpt: 'private Row lookupRow(int id) { return db.get(id); }' });
  const helperV2 = cap({ name: 'lookupRow', excerpt: 'private Row lookupRow(int id) { return db.getCached(id); }' }); // behavior changed
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return lookupRow(id); }' }); // byte-for-byte unchanged

  const hashBefore = computeDependencyAwareSourceHash(find, [find, helperV1]);
  const hashAfter = computeDependencyAwareSourceHash(find, [find, helperV2]);
  assert.notEqual(hashBefore, hashAfter, "find's own excerpt didn't change, but its dependency's behavior did — the hash must still change");
});

test('computeDependencyAwareSourceHash is UNCHANGED when an UNRELATED same-file capability (never called) changes', () => {
  const unrelatedV1 = cap({ name: 'closeConnection', excerpt: 'public void closeConnection() { conn.close(); }' });
  const unrelatedV2 = cap({ name: 'closeConnection', excerpt: 'public void closeConnection() { conn.close(); logClose(); }' });
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return byId(id); }' }); // never calls closeConnection

  const hashBefore = computeDependencyAwareSourceHash(find, [find, unrelatedV1]);
  const hashAfter = computeDependencyAwareSourceHash(find, [find, unrelatedV2]);
  assert.equal(hashBefore, hashAfter, 'a same-file capability find() never calls must never affect its hash');
});

test('selectSourceHashInput uses the LEGACY scheme (bare excerpt) for a whole-file capability', () => {
  const wholeFile = cap({ name: 'Config', kind: 'whole-file', excerpt: 'key=value\nother=thing' });
  const result = selectSourceHashInput(wholeFile, [wholeFile]);
  assert.equal(result.scheme, SOURCE_HASH_SCHEME_LEGACY);
  assert.equal(result.content, wholeFile.excerpt);
});

test('selectSourceHashInput uses the dependency-aware scheme for a real (method/constructor) capability', () => {
  const helper = cap({ name: 'lookupRow', excerpt: 'private Row lookupRow(int id) { return db.get(id); }' });
  const find = cap({ name: 'find', excerpt: 'public Row find(int id) { return lookupRow(id); }' });
  const result = selectSourceHashInput(find, [find, helper]);
  assert.equal(result.scheme, SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES);
  assert.match(result.content, /db\.get\(id\)/, 'the dependency\'s excerpt must be folded into what gets hashed');
});

// --- A09: dependency discovery must see the COMPLETE callable surface, not
// just the public/capped recipe-generation list -----------------------------

test('A09: computeDependencyAwareSourceHash changes when a PRIVATE helper (invisible to the public/capped list) changes', () => {
  const publicCaller = cap({ name: 'normalize', excerpt: 'public int normalize(int id) { return adjust(id); }' });
  const privateHelperV1 = cap({ name: 'adjust', excerpt: 'private int adjust(int id) { return id + 1; }' });
  const privateHelperV2 = cap({ name: 'adjust', excerpt: 'private int adjust(int id) { return id + 99; }' });

  // The exact reproduced A09 bug: hashing against ONLY the public/capped
  // list (the pre-fix behavior) can't see the private helper at all, so it
  // never changes regardless of the helper's own behavior.
  const oldStyleHashV1 = computeDependencyAwareSourceHash(publicCaller, [publicCaller]);
  const oldStyleHashV2 = computeDependencyAwareSourceHash(publicCaller, [publicCaller]);
  assert.equal(oldStyleHashV1, oldStyleHashV2, 'sanity check: the public-only list genuinely can\'t see the private helper');

  // The FIX: hashing against the COMPLETE callable surface (which
  // ragCorpusGenerator.ts/ragFreshnessChecker.ts now both use — see
  // extractAllCallableUnitsForDependencyDiscovery()) correctly changes.
  const fixedHashV1 = computeDependencyAwareSourceHash(publicCaller, [publicCaller, privateHelperV1]);
  const fixedHashV2 = computeDependencyAwareSourceHash(publicCaller, [publicCaller, privateHelperV2]);
  assert.notEqual(fixedHashV1, fixedHashV2, 'a change to a PRIVATE helper the public capability actually calls must change its dependency-aware hash');
});

test('A09: findAllSameFileDependencies (via buildDependencyAwareCanonicalContent) never duplicates the ROOT capability into its own dependency list, even when the search space is a SEPARATELY extracted (broader) list that also contains it', () => {
  // Simulates the REAL post-fix shape: `capability` (root) drawn from one
  // extraction pass (the public/capped list), `allCapabilities` from a
  // SEPARATE, broader pass that naturally re-extracts the SAME public
  // method too (as a genuinely different object, structurally identical) —
  // this must never let the root appear as its own "dependency" via a
  // recursive self-call, which would duplicate its own excerpt in the
  // canonical content.
  const rootFromNarrowPass = cap({ name: 'find', excerpt: 'public Row find(int id) { return id > 0 ? find(id - 1) : byId(id); }' });
  const sameMethodFromBroadPass = cap({ name: 'find', excerpt: 'public Row find(int id) { return id > 0 ? find(id - 1) : byId(id); }' }); // a DIFFERENT object, same real method
  const canonical = buildDependencyAwareCanonicalContent(rootFromNarrowPass, [sameMethodFromBroadPass]);
  assert.equal(canonical, rootFromNarrowPass.excerpt, 'the root\'s own excerpt must appear exactly ONCE, never duplicated as its own "dependency"');
});

test('A09: end-to-end — extractAllCallableUnitsForDependencyDiscovery() feeding computeDependencyAwareSourceHash() closes the exact reproduced review case', () => {
  const javaV1 = `public class IdHelper {\n  public int normalize(int id) {\n    return adjust(id);\n  }\n\n  private int adjust(int id) {\n    return id + 1;\n  }\n}\n`;
  const javaV2 = javaV1.replace('id + 1', 'id + 99');

  const publicOnlyV1 = extractCapabilities('IdHelper.java', javaV1);
  const publicOnlyV2 = extractCapabilities('IdHelper.java', javaV2);
  const normalizeV1 = publicOnlyV1.find((c) => c.name === 'normalize')!;
  const normalizeV2 = publicOnlyV2.find((c) => c.name === 'normalize')!;

  const allCallableV1 = extractAllCallableUnitsForDependencyDiscovery('IdHelper.java', javaV1);
  const allCallableV2 = extractAllCallableUnitsForDependencyDiscovery('IdHelper.java', javaV2);

  const hashV1 = computeDependencyAwareSourceHash(normalizeV1, allCallableV1);
  const hashV2 = computeDependencyAwareSourceHash(normalizeV2, allCallableV2);
  assert.notEqual(hashV1, hashV2, 'changing the private adjust() helper must change normalize()\'s dependency-aware hash — the exact review repro');
});

// --- F09: isPathContained (real-path symlink-containment re-check) ----------

test('isPathContained accepts a path nested one level under the root', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(isPathContained(path.join(root, 'src', 'Foo.java'), root), true);
});

test('isPathContained accepts the root itself (equal paths)', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(isPathContained(root, root), true);
});

test('isPathContained rejects a sibling directory that merely shares a name PREFIX with the root (the classic "startsWith" bug)', () => {
  const root = path.join('workspace', 'proj');
  const sibling = path.join('workspace', 'proj-evil-twin', 'Foo.java');
  assert.equal(isPathContained(sibling, root), false);
});

test('isPathContained rejects a path entirely outside the root', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(isPathContained(path.join('etc', 'passwd'), root), false);
});

test('isPathContained normalizes both inputs before comparing (trailing separators/./.. never cause a false mismatch)', () => {
  const root = path.join('workspace', 'proj') + path.sep;
  const candidate = path.join('workspace', 'proj', 'a', '..', 'src', 'Foo.java');
  assert.equal(isPathContained(candidate, root), true);
});

test('resolveSafeRelativePath (refactored to reuse isPathContained) still refuses a path that would escape the root', () => {
  assert.equal(resolveSafeRelativePath(path.join('workspace', 'proj'), '../proj/src/Foo.java'), undefined);
});

test('resolveSafeRelativePath (refactored to reuse isPathContained) still accepts an ordinary nested path', () => {
  const root = path.join('workspace', 'proj');
  assert.equal(resolveSafeRelativePath(root, 'src/Foo.java'), path.join(root, 'src', 'Foo.java'));
});
