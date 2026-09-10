import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { ORDER_CALCULATOR_SOURCE_FILENAME, ORDER_CALCULATOR_RECIPE_FILENAME, ORDER_CALCULATOR_RECIPE_ID, ORDER_CALCULATOR_JAVA_V2 } from '../fixtures';

/**
 * Runs INSIDE a real, automated Extension Development Host (launched by
 * `../runTest.ts`) against the fixture workspace that file built — a real
 * `vscode` module, a real activated extension, a real filesystem. See
 * `runTest.ts`'s own top-level doc comment for what this suite can and
 * can't reach (command-invokable logic only — no webview automation).
 *
 * `ragFreshnessService`/`ragIndexer` are required directly (not only
 * invoked through the registered command) so the ACTUAL data can be
 * asserted on — `objectSpy.checkRagFreshness`'s own command handler
 * currently returns nothing (`await panelManager.checkRagSourceFreshness()`,
 * result discarded — see extension.ts), so the command itself is exercised
 * separately below purely to confirm it runs without throwing. This file
 * runs INSIDE the same Extension Host process either way, so `require('vscode')`
 * inside these modules resolves to the same real module this test file's
 * own `import * as vscode` does — no fake, no stub.
 */

const ragServiceDir = path.join(__dirname, '..', '..', 'src', 'rag');
const { getOrBuildFreshnessReport, clearRagFreshnessCache } = require(path.join(ragServiceDir, 'ragFreshnessService'));
const { clearRagIndexCache } = require(path.join(ragServiceDir, 'ragIndexer'));

interface FreshnessEntryLike {
  recipeId: string;
  state: string;
  detail: string;
}

function workspaceRoot(): vscode.Uri {
  const folders = vscode.workspace.workspaceFolders;
  assert.ok(folders && folders.length > 0, 'the Extension Host must have opened the fixture workspace runTest.ts built');
  return folders![0].uri;
}

function sourceFilePath(): string {
  return path.join(workspaceRoot().fsPath, ORDER_CALCULATOR_SOURCE_FILENAME);
}

function ragFolderPath(): string {
  return path.join(workspaceRoot().fsPath, '.github', 'rag');
}

async function freshEntries(): Promise<FreshnessEntryLike[]> {
  clearRagIndexCache();
  clearRagFreshnessCache();
  const report = await getOrBuildFreshnessReport(workspaceRoot(), { forceRefresh: true });
  return report.entries;
}

describe('RAG source freshness — real Extension Host integration (F09, F16)', () => {
  before(() => {
    // Sanity check: the fixture runTest.ts wrote BEFORE launching this host
    // must actually be there — a failure here means fixture SETUP is
    // broken, not the extension itself.
    assert.ok(fs.existsSync(sourceFilePath()), `expected fixture source file at ${sourceFilePath()}`);
    assert.ok(fs.existsSync(path.join(ragFolderPath(), ORDER_CALCULATOR_RECIPE_FILENAME)), 'expected the hand-built fixture recipe to exist');
  });

  it('the real registered "objectSpy.checkRagFreshness" command runs without throwing', async () => {
    await vscode.commands.executeCommand('objectSpy.checkRagFreshness');
  });

  it('F09: reports FRESH against the real, unmodified source file', async () => {
    const entries = await freshEntries();
    const entry = entries.find((e) => e.recipeId === ORDER_CALCULATOR_RECIPE_ID);
    assert.ok(entry, 'the fixture recipe must be indexed');
    assert.equal(entry!.state, 'fresh');
  });

  it(
    "F09: a same-file DEPENDENCY changing on REAL disk is detected as STALE, even though the capability's own excerpt did not change " +
      "— the live, real-vscode confirmation of this session's F09 fix",
    async () => {
      const originalContent = fs.readFileSync(sourceFilePath(), 'utf8');
      try {
        // Only applyTax's own body differs in V2 — totalWithTax's own
        // lines are byte-for-byte identical to what the fixture recipe's
        // sourceHash was computed against.
        fs.writeFileSync(sourceFilePath(), ORDER_CALCULATOR_JAVA_V2, 'utf8');
        const entries = await freshEntries();
        const entry = entries.find((e) => e.recipeId === ORDER_CALCULATOR_RECIPE_ID);
        assert.ok(entry);
        assert.equal(
          entry!.state,
          'stale',
          "totalWithTax calls applyTax in the SAME file — a real behavior change there must be visible as staleness even though totalWithTax's own source text is untouched"
        );
      } finally {
        fs.writeFileSync(sourceFilePath(), originalContent, 'utf8');
      }
    }
  );

  it('F16: a real .github/rag folder containing an invalid-shaped file alongside a valid one indexes ONLY the valid one', async () => {
    // Mirrors the exact reproduced F16 scenario
    // (.github/rag/bdd-java-framework-guide.md in the real repo) — a second
    // Markdown file with no YAML frontmatter sitting in the SAME real
    // folder as the valid fixture recipe.
    const invalidFilePath = path.join(ragFolderPath(), 'not-a-recipe.md');
    fs.writeFileSync(invalidFilePath, '# Not a recipe\n\nJust prose, no frontmatter.\n', 'utf8');
    try {
      const entries = await freshEntries();
      assert.equal(entries.length, 1, 'only the one VALID recipe should be indexed — the invalid file must be silently skipped, never crash indexing or get treated as a recipe');
      assert.equal(entries[0].recipeId, ORDER_CALCULATOR_RECIPE_ID);
    } finally {
      fs.unlinkSync(invalidFilePath);
    }
  });
});
