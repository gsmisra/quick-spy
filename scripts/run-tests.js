// Runs the compiled test suite (see tsconfig.test.json / npm's "pretest")
// via Node's built-in test runner, passing every "*.test.js" file under
// out-test/test as an EXPLICIT argument rather than a glob pattern.
//
// Why: `node --test "out-test/test/**/*.test.js"` only works on Node
// versions new enough to expand a glob pattern given as a bare positional
// argument itself -- that support is NOT present in Node 20 (still a very
// common corporate-managed LTS, e.g. a bank-issued laptop pinned to an
// older Node), where it fails with "Could not find <the literal pattern
// string>" instead of running any test. Passing an explicit list of real
// file paths is the one invocation shape Node's test runner has supported
// unchanged since it was introduced (Node 18+), so this works identically
// on every Node version this extension's build process might run under.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const testRoot = path.join(__dirname, '..', 'out-test', 'test');

function collectTestFiles(dir) {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return files;
    }
    throw err;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  return files;
}

const testFiles = collectTestFiles(testRoot);

if (testFiles.length === 0) {
  console.error(
    `No compiled test files found under ${testRoot} -- did "npm run pretest" (tsc -p tsconfig.test.json) run first?`
  );
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], { stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
