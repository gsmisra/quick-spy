import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  classifyFreshness,
  extractCapabilityNameFromSourcePath,
  extractComparableContent,
  SourceFileResolution
} from '../../src/rag/ragFreshnessChecker';
import {
  hashSourceContent,
  buildSourceIdentity,
  buildDependencyAwareCanonicalContent,
  SOURCE_HASH_SCHEME_LEGACY,
  SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES
} from '../../src/rag/ragSourceIdentity';
import { extractCapabilities } from '../../src/rag/ragCapabilityExtraction';

// --- extractCapabilityNameFromSourcePath ------------------------------------

test('extractCapabilityNameFromSourcePath extracts the name after "#"', () => {
  assert.equal(extractCapabilityNameFromSourcePath('src/db/CsqlHelper.java#queryOne'), 'queryOne');
});

test('extractCapabilityNameFromSourcePath returns undefined for a whole-file sourcePath', () => {
  assert.equal(extractCapabilityNameFromSourcePath('src/db/CsqlHelper.java'), undefined);
});

// --- extractComparableContent -----------------------------------------------

const JAVA_FILE = `package com.acme.db;

public class CsqlHelper {
  public Row queryOne(String sql) {
    return execute(sql);
  }

  public void close() {
    connection.close();
  }
}
`;

test('extractComparableContent returns the WHOLE file for a whole-file sourcePath (no "#" suffix)', () => {
  assert.equal(extractComparableContent('src/db/CsqlHelper.java', JAVA_FILE), JAVA_FILE);
});

test('extractComparableContent re-extracts ONLY the named capability\'s own excerpt for a per-capability sourcePath', () => {
  const comparable = extractComparableContent('src/db/CsqlHelper.java#queryOne', JAVA_FILE);
  assert.ok(comparable);
  assert.match(comparable!, /queryOne/);
  assert.doesNotMatch(comparable!, /close\(\)/);
});

test('extractComparableContent returns undefined when the named capability can no longer be found', () => {
  const comparable = extractComparableContent('src/db/CsqlHelper.java#renamedAway', JAVA_FILE);
  assert.equal(comparable, undefined);
});

test('extractComparableContent uses the sourcePath\'s own basename to dispatch by extension, ignoring folder segments', () => {
  const pythonFile = 'def query_one(sql):\n    return execute(sql)\n';
  const comparable = extractComparableContent('framework/db/client.py#query_one', pythonFile);
  assert.ok(comparable);
  assert.match(comparable!, /query_one/);
});

// --- F09: re-matching an OVERLOADED capability by its disambiguated namingId (regression from this session's own F02 fix) ---

const OVERLOADED_JAVA_FILE = `public class Finder {
  public Row find(int id) {
    return byId(id);
  }

  public Row find(String name) {
    return byName(name);
  }
}
`;

test('extractComparableContent correctly re-finds an OVERLOADED capability via its disambiguated namingId-based sourcePath (the reproduced F09 regression)', () => {
  // Mirrors exactly what ragCorpusGenerator.ts actually stamps for an
  // overloaded method: buildSourceIdentity()'s "#" suffix is
  // capability.namingId (e.g. "find-a1b2c3"), NEVER the bare "find" —
  // see ragCapabilityExtraction.ts's own disambiguateCapabilityNames().
  const capabilities = extractCapabilities('Finder.java', OVERLOADED_JAVA_FILE);
  assert.equal(capabilities.length, 2);
  const [first, second] = capabilities;
  assert.ok(first.namingId, 'the first overload must have a disambiguated namingId');
  assert.ok(second.namingId, 'the second overload must have a disambiguated namingId');
  assert.notEqual(first.namingId, second.namingId);

  const sourcePathForFirst = `src/db/Finder.java#${first.namingId}`;
  const comparable = extractComparableContent(sourcePathForFirst, OVERLOADED_JAVA_FILE);
  assert.ok(comparable, 'the overload must be re-findable by its own disambiguated namingId, not just its bare name');
  assert.equal(comparable, first.excerpt);
});

// --- A05: re-matching a capability disambiguated by OWNER (not signature),
// the cross-owner-same-name shape --------------------------------------

const TWO_OWNERS_PYTHON_FILE = `class A:
    def run(self):
        return 1


class B:
    def run(self):
        return 2
`;

test('extractComparableContent correctly re-finds a capability disambiguated by OWNER NAME (A05) — same bare name, different owners, same file', () => {
  const capabilities = extractCapabilities('multi.py', TWO_OWNERS_PYTHON_FILE);
  assert.equal(capabilities.length, 2);
  const [a, b] = capabilities;
  assert.ok(a.namingId, 'A05 fix: a bare-name collision across DIFFERENT owners must still get a namingId');
  assert.ok(b.namingId);
  assert.notEqual(a.namingId, b.namingId);

  const comparableForA = extractComparableContent(`src/multi.py#${a.namingId}`, TWO_OWNERS_PYTHON_FILE);
  assert.ok(comparableForA, 'A\'s own run() must be re-findable by its owner-disambiguated namingId');
  assert.equal(comparableForA, a.excerpt);

  const comparableForB = extractComparableContent(`src/multi.py#${b.namingId}`, TWO_OWNERS_PYTHON_FILE);
  assert.ok(comparableForB, 'B\'s own run() must be re-findable by its OWN owner-disambiguated namingId, distinct from A\'s');
  assert.equal(comparableForB, b.excerpt);
  assert.notEqual(comparableForA, comparableForB);
});

test('extractComparableContent still works for a NON-overloaded capability (no namingId at all) via its plain name', () => {
  const comparable = extractComparableContent('src/db/CsqlHelper.java#queryOne', JAVA_FILE);
  assert.ok(comparable);
  assert.match(comparable!, /queryOne/);
});

// --- classifyFreshness -------------------------------------------------------

test('classifyFreshness reports "unverifiable" when neither sourcePath nor sourceHash is recorded', () => {
  const result = classifyFreshness({}, undefined);
  assert.equal(result.state, 'unverifiable');
  assert.match(result.detail, /No source provenance recorded/);
});

test('classifyFreshness reports "unverifiable" when only sourcePath is recorded (no hash to compare)', () => {
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java' }, undefined);
  assert.equal(result.state, 'unverifiable');
  assert.match(result.detail, /incomplete provenance/);
});

test('classifyFreshness reports "unverifiable" when only sourceHash is recorded (no path to resolve)', () => {
  const result = classifyFreshness({ sourceHash: hashSourceContent('x') }, undefined);
  assert.equal(result.state, 'unverifiable');
  assert.match(result.detail, /incomplete provenance/);
});

test('classifyFreshness reports "error" for a blocked (path-traversal-refused) resolution', () => {
  const resolution: SourceFileResolution = { kind: 'blocked', reason: 'escapes every open workspace folder' };
  const result = classifyFreshness({ sourcePath: '../../etc/passwd', sourceHash: hashSourceContent('x') }, resolution);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /Refused to resolve/);
});

test('classifyFreshness reports "error" for a read-error resolution, distinct from "missing"', () => {
  const resolution: SourceFileResolution = { kind: 'read-error', message: 'EACCES' };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x') }, resolution);
  assert.equal(result.state, 'error');
  assert.match(result.detail, /EACCES/);
});

test('classifyFreshness reports "missing" when the source path could not be found anywhere', () => {
  const resolution: SourceFileResolution = { kind: 'not-found' };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x') }, resolution);
  assert.equal(result.state, 'missing');
  assert.match(result.detail, /moved\/renamed\/deleted/);
  // F09: never asserts deletion as the ONLY explanation — a source that
  // was never part of any workspace opened here is an equally valid,
  // more benign possibility this wording must also acknowledge.
  assert.match(result.detail, /never part of a project opened in this workspace/);
});

// --- A07: sourceMapped distinguishes "went missing" from "never mapped" --

test('classifyFreshness reports "missing" (UNCHANGED) when sourceMapped is explicitly true and the source can no longer be found — a real disappearance', () => {
  const resolution: SourceFileResolution = { kind: 'not-found' };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x'), sourceMapped: true }, resolution);
  assert.equal(result.state, 'missing');
});

test('classifyFreshness reports "unverifiable" (NEVER "missing") when sourceMapped is false and the source cannot be found — a genuinely external upload, never confirmed present to begin with', () => {
  const resolution: SourceFileResolution = { kind: 'not-found' };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x'), sourceMapped: false }, resolution);
  assert.equal(result.state, 'unverifiable');
  assert.match(result.detail, /never confirmed present/);
  assert.match(result.detail, /external upload/);
});

test('classifyFreshness sourceMapped: false has NO effect on a "found" resolution — freshness is still checked normally once the source IS resolvable', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE), sourceMapped: false }, resolution);
  assert.equal(result.state, 'fresh', 'a previously-unmapped source that IS now resolvable (e.g. its project was opened) must be checked for real, not permanently treated as unverifiable');
});

test('classifyFreshness treats an ABSENT sourceMapped exactly like sourceMapped: true (backward compatible with every recipe generated before this field existed)', () => {
  const resolution: SourceFileResolution = { kind: 'not-found' };
  const withUndefined = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x') }, resolution);
  const withTrue = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent('x'), sourceMapped: true }, resolution);
  assert.equal(withUndefined.state, 'missing');
  assert.equal(withUndefined.state, withTrue.state);
});

test('classifyFreshness reports "fresh" for a whole-file recipe whose current content still hashes the same', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) }, resolution);
  assert.equal(result.state, 'fresh');
  assert.equal(result.resolvedPath, '/ws/src/db/CsqlHelper.java');
});

test('classifyFreshness reports "stale" for a whole-file recipe whose current content hashes differently', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE + '\n// a change', resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) }, resolution);
  assert.equal(result.state, 'stale');
  assert.match(result.detail, /has changed since this recipe was generated/);
});

test('classifyFreshness reports "fresh" for a per-capability recipe when that ONE capability is unchanged, even if the REST of the file changed', () => {
  const originalExcerpt = extractComparableContent('src/db/CsqlHelper.java#queryOne', JAVA_FILE)!;
  const sourceHash = hashSourceContent(originalExcerpt);
  const changedElsewhereFile = JAVA_FILE.replace('connection.close();', 'connection.close(); // added a comment');
  const resolution: SourceFileResolution = { kind: 'found', content: changedElsewhereFile, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java#queryOne', sourceHash }, resolution);
  assert.equal(result.state, 'fresh');
});

test('classifyFreshness reports "stale" for a per-capability recipe when that SPECIFIC capability changed', () => {
  const originalExcerpt = extractComparableContent('src/db/CsqlHelper.java#queryOne', JAVA_FILE)!;
  const sourceHash = hashSourceContent(originalExcerpt);
  const changedFile = JAVA_FILE.replace('return execute(sql);', 'return execute(sql.trim());');
  const resolution: SourceFileResolution = { kind: 'found', content: changedFile, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java#queryOne', sourceHash }, resolution);
  assert.equal(result.state, 'stale');
});

test('classifyFreshness reports "stale" (not "error" or a crash) when the named capability has since been removed', () => {
  const sourceHash = hashSourceContent(extractComparableContent('src/db/CsqlHelper.java#queryOne', JAVA_FILE)!);
  const fileWithoutCapability = JAVA_FILE.replace(/public Row queryOne[\s\S]*?\n  \}\n\n/, '');
  const resolution: SourceFileResolution = { kind: 'found', content: fileWithoutCapability, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java#queryOne', sourceHash }, resolution);
  assert.equal(result.state, 'stale');
  assert.match(result.detail, /could no longer be found/);
});

test('classifyFreshness round-trips buildSourceIdentity()\'s own output as a real sourcePath', () => {
  const sourcePath = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  const sourceHash = hashSourceContent(extractComparableContent(sourcePath, JAVA_FILE)!);
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath, sourceHash }, resolution);
  assert.equal(result.state, 'fresh');
});

// --- F09: dependency-aware hashing + a persisted hash-scheme version --------

const HELPER_JAVA_FILE_V1 = `package com.acme.db;

public class CsqlHelper {
  public Row queryOne(String sql) {
    return execute(sql);
  }

  public Row execute(String sql) {
    return conn.run(sql);
  }
}
`;

// Only "execute"'s own behavior changed — "queryOne"'s own excerpt (source
// text) is byte-for-byte IDENTICAL to V1, even though calling queryOne now
// behaves differently because the helper it depends on does.
const HELPER_JAVA_FILE_V2 = `package com.acme.db;

public class CsqlHelper {
  public Row queryOne(String sql) {
    return execute(sql);
  }

  public Row execute(String sql) {
    return conn.runCached(sql);
  }
}
`;

test('classifyFreshness under the LEGACY scheme reports "fresh" when a same-file DEPENDENCY changes but the capability\'s own excerpt did not (the reproduced F09 gap)', () => {
  const capsV1 = extractCapabilities('CsqlHelper.java', HELPER_JAVA_FILE_V1);
  const queryOne = capsV1.find((c) => c.name === 'queryOne')!;
  const sourcePath = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  const sourceHash = hashSourceContent(queryOne.excerpt); // LEGACY: excerpt only, no dependency awareness
  const resolution: SourceFileResolution = { kind: 'found', content: HELPER_JAVA_FILE_V2, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath, sourceHash, sourceHashScheme: SOURCE_HASH_SCHEME_LEGACY }, resolution);
  assert.equal(result.state, 'fresh', 'demonstrates the pre-F09 blind spot: the dependency changed but LEGACY hashing cannot see it');
});

test('classifyFreshness under the dependency-aware scheme reports "stale" when a same-file DEPENDENCY changes, even though the capability\'s own excerpt did not (the F09 fix)', () => {
  const capsV1 = extractCapabilities('CsqlHelper.java', HELPER_JAVA_FILE_V1);
  const queryOne = capsV1.find((c) => c.name === 'queryOne')!;
  const sourcePath = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  const sourceHash = hashSourceContent(buildDependencyAwareCanonicalContent(queryOne, capsV1));
  const resolution: SourceFileResolution = { kind: 'found', content: HELPER_JAVA_FILE_V2, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath, sourceHash, sourceHashScheme: SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES }, resolution);
  assert.equal(result.state, 'stale', 'the dependency-aware scheme must catch a same-file helper behavior change');
});

test('classifyFreshness under the dependency-aware scheme still reports "fresh" when nothing relevant changed at all', () => {
  const capsV1 = extractCapabilities('CsqlHelper.java', HELPER_JAVA_FILE_V1);
  const queryOne = capsV1.find((c) => c.name === 'queryOne')!;
  const sourcePath = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  const sourceHash = hashSourceContent(buildDependencyAwareCanonicalContent(queryOne, capsV1));
  const resolution: SourceFileResolution = { kind: 'found', content: HELPER_JAVA_FILE_V1, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath, sourceHash, sourceHashScheme: SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES }, resolution);
  assert.equal(result.state, 'fresh');
});

test('classifyFreshness treats an ABSENT sourceHashScheme as LEGACY (backward compatible), never as unverifiable', () => {
  const result = classifyFreshness(
    { sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) },
    { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 }
  );
  assert.equal(result.state, 'fresh');
});

test('classifyFreshness reports "unverifiable" (never a guess) for a sourceHashScheme it does not recognize', () => {
  const result = classifyFreshness(
    { sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE), sourceHashScheme: 'sha256-some-future-scheme-v2' },
    { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 }
  );
  assert.equal(result.state, 'unverifiable');
  assert.match(result.detail, /doesn't recognize/);
});

test('extractComparableContent under the dependency-aware scheme folds a dependency\'s excerpt into the comparable text', () => {
  const sourcePath = buildSourceIdentity('CsqlHelper.java', 'src/db', 'queryOne');
  const comparable = extractComparableContent(sourcePath, HELPER_JAVA_FILE_V1, SOURCE_HASH_SCHEME_WITH_SAME_FILE_DEPENDENCIES);
  assert.ok(comparable);
  assert.match(comparable!, /return execute\(sql\)/); // queryOne's own excerpt
  assert.match(comparable!, /return conn\.run\(sql\)/); // execute's excerpt, folded in as a dependency
});

// --- F09: source-root ambiguity across multiple open workspace folders -----

test('classifyFreshness discloses source-root AMBIGUITY when another open folder also has a safe file at this path (a "fresh" verdict)', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws-a/src/db/CsqlHelper.java', otherCandidateFolderCount: 1 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) }, resolution);
  assert.equal(result.state, 'fresh');
  assert.match(result.detail, /1 other open workspace folder\(s\) ALSO have a file/);
  assert.match(result.detail, /ws-a\/src\/db\/CsqlHelper\.java/);
});

test('classifyFreshness discloses source-root AMBIGUITY on a "stale" verdict too, not just "fresh"', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE + '\n// changed', resolvedPath: '/ws-a/src/db/CsqlHelper.java', otherCandidateFolderCount: 2 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) }, resolution);
  assert.equal(result.state, 'stale');
  assert.match(result.detail, /2 other open workspace folder\(s\) ALSO have a file/);
});

test('classifyFreshness says NOTHING about ambiguity when only one folder has a safe file at this path (the common, unambiguous case)', () => {
  const resolution: SourceFileResolution = { kind: 'found', content: JAVA_FILE, resolvedPath: '/ws/src/db/CsqlHelper.java', otherCandidateFolderCount: 0 };
  const result = classifyFreshness({ sourcePath: 'src/db/CsqlHelper.java', sourceHash: hashSourceContent(JAVA_FILE) }, resolution);
  assert.equal(result.state, 'fresh');
  assert.doesNotMatch(result.detail, /other open workspace folder/);
});
