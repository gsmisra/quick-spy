import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';
import { ORDER_CALCULATOR_JAVA_V1, ORDER_CALCULATOR_SOURCE_FILENAME, ORDER_CALCULATOR_RECIPE_FILENAME, ORDER_CALCULATOR_RECIPE_ID } from './fixtures';

/**
 * Launches a REAL, automated VS Code Extension Development Host (via
 * `@vscode/test-electron`) and runs `./suite/index.ts` inside it — the
 * closest thing to an "Extension Host walkthrough" that doesn't need a
 * human clicking anything. Unlike `test/rag/ragCorpusGenerator.cancellation.test.ts`
 * and `test/rag/ragIndexer.summary.test.ts` (which fake `vscode` entirely via
 * `Module._load`), this uses the REAL `vscode` module, the REAL extension
 * activation path, and a REAL filesystem — catching anything a hand-built
 * fake might get subtly wrong (real `FileSystemError` semantics, real
 * `Uri.joinPath` behavior, real command registration, ...).
 *
 * Scope: no webview/GUI automation exists for this (or most) VS Code
 * extensions' own custom UI, so this can only exercise what's reachable via
 * `vscode.commands.executeCommand()` — concretely, `objectSpy.checkRagFreshness`.
 * RAG *generation* and *cancellation* (F14) are NOT re-tested here — they're
 * only reachable through the Settings webview's own message-passing, which
 * this harness has no way to script. Those stay covered by the `Module._load`
 * fake-vscode test instead (real orchestration logic, fake vscode) — this
 * suite is a genuinely DIFFERENT, complementary kind of check (real vscode,
 * command-reachable logic only), not a replacement for it.
 *
 * The scratch workspace this opens is built here (before the Extension Host
 * even launches, since `launchArgs` must name a real folder up front) using
 * the SAME pure hashing logic (`selectSourceHashInput`/`hashSourceContent`)
 * a real "Generate RAG Corpus format" run would use — so the hand-built
 * fixture recipe is indistinguishable, to the freshness checker, from one
 * that generation actually produced. The workspace is deleted again once
 * the run finishes, whether it passed or failed.
 */

interface PureRagModules {
  extractCapabilities: (fileName: string, content: string) => Array<{ name: string; excerpt: string; kind: string; ownerClassName?: string; namingId?: string; signature: string }>;
  selectSourceHashInput: (capability: unknown, allCapabilities: unknown[]) => { content: string; scheme: string };
  hashSourceContent: (content: string) => string;
  buildSourceIdentity: (fileName: string, relativePath: string | undefined, capabilityName?: string) => string;
  serializeRagFile: (frontmatter: Record<string, unknown>, body: string) => string;
}

/** Loads the extension's own pure RAG modules from the SAME compiled output
 * this runner itself lives in (`tsconfig.test-integration.json` compiles
 * `src/**` alongside `test-integration/**` into one `out-test-integration/`
 * tree — mirroring `tsconfig.test.json`'s identical pattern for the plain
 * unit-test suite) — never from `out/` (the extension's OWN production
 * build, which `extensionDevelopmentPath` below points the Extension Host
 * at directly; this runner has no need to load that copy itself). */
function loadPureRagModules(): PureRagModules {
  const ragDir = path.join(__dirname, '..', 'src', 'rag');
  const sourceIdentity = require(path.join(ragDir, 'ragSourceIdentity'));
  const capabilityExtraction = require(path.join(ragDir, 'ragCapabilityExtraction'));
  const frontmatter = require(path.join(ragDir, 'ragFrontmatter'));
  return {
    extractCapabilities: capabilityExtraction.extractCapabilities,
    selectSourceHashInput: sourceIdentity.selectSourceHashInput,
    hashSourceContent: sourceIdentity.hashSourceContent,
    buildSourceIdentity: sourceIdentity.buildSourceIdentity,
    serializeRagFile: frontmatter.serializeRagFile
  };
}

function buildFixtureWorkspace(): string {
  const { extractCapabilities, selectSourceHashInput, hashSourceContent, buildSourceIdentity, serializeRagFile } = loadPureRagModules();

  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'softplay-rag-integration-'));
  const ragDir = path.join(workspaceDir, '.github', 'rag');
  fs.mkdirSync(ragDir, { recursive: true });
  fs.writeFileSync(path.join(workspaceDir, ORDER_CALCULATOR_SOURCE_FILENAME), ORDER_CALCULATOR_JAVA_V1, 'utf8');

  const capabilities = extractCapabilities(ORDER_CALCULATOR_SOURCE_FILENAME, ORDER_CALCULATOR_JAVA_V1);
  const totalWithTax = capabilities.find((c) => c.name === 'totalWithTax');
  if (!totalWithTax) {
    throw new Error('Integration test setup failed: extractCapabilities() did not find "totalWithTax" in the fixture source — the fixture or the extractor changed shape.');
  }
  const hashInput = selectSourceHashInput(totalWithTax, capabilities);
  const sourcePath = buildSourceIdentity(ORDER_CALCULATOR_SOURCE_FILENAME, undefined, 'totalWithTax');
  const sourceHash = hashSourceContent(hashInput.content);

  const recipeContent = serializeRagFile(
    {
      id: ORDER_CALCULATOR_RECIPE_ID,
      title: 'Compute an order total including tax',
      tags: ['order', 'tax', 'calculator'],
      automationMode: ['api'],
      language: ['java'],
      sourcePath,
      sourceHash,
      sourceHashScheme: hashInput.scheme
    },
    'Use: Compute the final charge for an order including tax.\nRequires: None.\nAPI: public double totalWithTax(double subtotal)\n\n```java\ndouble total = orderCalculator.totalWithTax(19.99);\n```\n'
  );
  fs.writeFileSync(path.join(ragDir, ORDER_CALCULATOR_RECIPE_FILENAME), recipeContent, 'utf8');

  return workspaceDir;
}

async function main(): Promise<void> {
  const workspaceDir = buildFixtureWorkspace();
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [workspaceDir, '--disable-extensions'],
      extensionTestsEnv: { SOFTPLAY_TEST_WORKSPACE: workspaceDir }
    });
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Extension Host integration tests failed to run:', err);
  process.exitCode = 1;
});
