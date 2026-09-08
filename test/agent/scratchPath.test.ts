import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { resolveWithinScratchDir } from '../../src/agent/scratchPath';

/**
 * The Verify & Fix agent's `read_file` tool trusts this function completely
 * to keep an LLM-supplied path from ever escaping the disposable scratch
 * project it's allowed to inspect. Every one of these cases is a real
 * traversal shape an adversarial or simply confused model response could
 * plausibly produce — this suite exists to make an escape a loud, obvious
 * test failure, not a silent security regression.
 */

const SCRATCH = path.join('C:', 'fake', 'scratch', 'dir');

test('accepts a simple relative path inside the scratch dir', () => {
  const resolved = resolveWithinScratchDir(SCRATCH, 'pom.xml');
  assert.equal(resolved, path.join(SCRATCH, 'pom.xml'));
});

test('accepts a nested relative path inside the scratch dir', () => {
  const resolved = resolveWithinScratchDir(SCRATCH, path.join('src', 'test', 'java', 'Foo.java'));
  assert.equal(resolved, path.join(SCRATCH, 'src', 'test', 'java', 'Foo.java'));
});

test('accepts the scratch dir itself', () => {
  const resolved = resolveWithinScratchDir(SCRATCH, '.');
  assert.equal(resolved, path.resolve(SCRATCH));
});

test('rejects a ".." traversal that climbs out of the scratch dir', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, path.join('..', 'secret.txt')), null);
});

test('rejects a deeply nested ".." traversal that still climbs out', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, path.join('a', 'b', '..', '..', '..', '..', 'etc', 'passwd')), null);
});

test('rejects a Windows absolute path outright', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, 'C:\\Windows\\System32\\config\\SAM'), null);
});

test('rejects a POSIX absolute path outright', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, '/etc/passwd'), null);
});

test('rejects a sibling directory that merely shares the scratch dir\'s string prefix', () => {
  // "dir-evil" starts with the same characters as "dir" but is a different,
  // sibling directory — a naive `startsWith(base)` check (without a
  // trailing separator) would wrongly accept this.
  const evilSibling = path.join('C:', 'fake', 'scratch', 'dir-evil', 'secret.txt');
  const relativeFromScratch = path.relative(SCRATCH, evilSibling);
  assert.equal(resolveWithinScratchDir(SCRATCH, relativeFromScratch), null);
});

test('rejects a non-string path', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, undefined), null);
  assert.equal(resolveWithinScratchDir(SCRATCH, 42), null);
  assert.equal(resolveWithinScratchDir(SCRATCH, null), null);
  assert.equal(resolveWithinScratchDir(SCRATCH, { path: '../x' }), null);
});

test('rejects an empty or whitespace-only path', () => {
  assert.equal(resolveWithinScratchDir(SCRATCH, ''), null);
  assert.equal(resolveWithinScratchDir(SCRATCH, '   '), null);
});
