import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';
import * as yaml from 'js-yaml';

/**
 * A07: an AUTOMATED regression test proving `generateRagCorpus()` actually
 * stamps `sourceMapped` using the REAL resolution logic
 * (ragFreshnessService.ts's `resolveSourceFile()`) at generation time — not
 * just that `classifyFreshness()` in isolation handles a `sourceMapped:
 * false` frontmatter value correctly (see ragFreshnessChecker.test.ts for
 * that half). Before this fix, a recipe generated from a genuinely
 * external upload (never part of any open workspace) was later classified
 * `missing` by freshness checking — exactly like a source that was
 * confirmed present and then deleted — and BOTH generation flows
 * (agenticModeController.ts, objectSpyPanel.ts) hard-exclude `missing`
 * recipes from every future prompt, so a brand-new, perfectly valid
 * recipe became silently unusable the moment it was generated.
 *
 * Uses the SAME `Module._load` fake-vscode technique as
 * `ragCorpusGenerator.redaction.test.ts` (A01)/`ragCorpusGenerator.cancellation.test.ts`
 * (F14) to run the REAL, compiled `generateRagCorpus()` end-to-end —
 * deliberately a small duplicate of that harness (per this codebase's own
 * established per-test-file fixture convention) rather than a shared
 * import, so this file stays independently readable and doesn't risk
 * perturbing an already-passing sibling test file for an unrelated
 * finding. The one addition beyond the A01 harness: a `workspaceFolders`
 * array and a path-aware `stat`/`readFile` fake, so the REAL
 * `resolveSourceFile()` (ragFreshnessService.ts) — which this fix newly
 * wires into `generateRagCorpus()` — actually exercises both a "resolves
 * to a real file" and a "resolves to nothing" outcome, not just the
 * blanket ENOENT the A01/F14 harnesses use (which never needed to
 * distinguish the two).
 */

interface FakeUri {
  fsPath: string;
  path: string;
  // Deliberately NOT 'file' — a non-'file' scheme makes
  // ragFreshnessService.ts's `isSymlinkEscapeSafe()` treat every candidate
  // as already safe without touching the REAL local filesystem's
  // `fs.promises.realpath()` at all (see that function's own doc comment
  // on this exact scoped behavior) — the cleanest way to exercise
  // `resolveSourceFile()` end-to-end against purely synthetic paths that
  // don't exist anywhere on the real disk.
  scheme: 'fake-remote';
  toString(): string;
}

function fakeUri(p: string): FakeUri {
  return { fsPath: p, path: p, scheme: 'fake-remote', toString: () => p };
}

class FakeFileSystemError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

const FakeFileType = { File: 1, Directory: 2 };

const MAPPED_SOURCE_PATH = '/fake-workspace/PostgresHelper.java';
const MAPPED_SOURCE_CONTENT = 'public class PostgresHelper {\n  public Row find(int id) {\n    return byId(id);\n  }\n}\n';

interface FakeState {
  writes: { path: string; text: string }[];
  progress: { fileName: string; status: string; message?: string }[];
  responder: (fileName: string) => Promise<string>;
}

const state: FakeState = { writes: [], progress: [], responder: async () => '' };

function resetState(responder: FakeState['responder']): void {
  state.writes = [];
  state.progress = [];
  state.responder = responder;
}

const fakeVsCode = {
  Uri: {
    file: fakeUri,
    joinPath: (base: FakeUri, ...parts: string[]) => fakeUri(path.posix.join(base.path, ...parts))
  },
  RelativePattern: class {
    constructor(
      public base: unknown,
      public pattern: string
    ) {}
  },
  FileSystemError: FakeFileSystemError,
  FileType: FakeFileType,
  workspace: {
    // One open workspace folder — the SAME folder generateRagCorpus() is
    // told to write the corpus under, matching the real, common case
    // (`.github/rag` and the project's own source both live under the
    // same open folder).
    workspaceFolders: [{ uri: fakeUri('/fake-workspace'), name: 'fake', index: 0 }],
    fs: {
      createDirectory: async () => {},
      stat: async (u: FakeUri) => {
        if (u.path === MAPPED_SOURCE_PATH) {
          return { type: FakeFileType.File, mtime: 0, size: MAPPED_SOURCE_CONTENT.length };
        }
        // Every other path — including every `.github/rag/*` target-name
        // existence check, and the genuinely-external file's own path —
        // "doesn't exist," same blanket behavior as the A01/F14 harnesses.
        throw new FakeFileSystemError('FileNotFound');
      },
      readFile: async (u: FakeUri) => {
        if (u.path === MAPPED_SOURCE_PATH) {
          return Buffer.from(MAPPED_SOURCE_CONTENT, 'utf8');
        }
        throw new FakeFileSystemError('FileNotFound');
      },
      writeFile: async (u: FakeUri, bytes: Uint8Array) => {
        state.writes.push({ path: u.path, text: Buffer.from(bytes).toString('utf8') });
      }
    },
    findFiles: async () => [] as FakeUri[],
    asRelativePath: (u: FakeUri | string) => (typeof u === 'string' ? u : u.path)
  }
};

const fakeCopilotClient = {
  CopilotUnavailableError: class extends Error {},
  countModelTokens: async () => ({ count: 200, maxInputTokens: 10_000 }),
  sendPrompt: async (_modelId: string, prompt: string, onChunk: (chunk: string) => void) => {
    const fileNameMatch = prompt.match(/### File's path within the uploaded project\n(\S+)/);
    const fileName = fileNameMatch ? path.posix.basename(fileNameMatch[1]) : '';
    onChunk(await state.responder(fileName));
  }
};

const fakeFileCache = {
  readFileCachedSync: () => fs.readFileSync(path.join(__dirname, '..', '..', '..', 'prompts', 'generate-rag-recipe.md'), 'utf8')
};

type GenerateRagCorpusFn = (options: {
  modelId: string;
  files: { fileName: string; content: string; relativePath?: string }[];
  workspaceRoot: FakeUri;
  cancellationToken: { isCancellationRequested: boolean };
  onProgress: (p: { fileName: string; status: string; message?: string }) => void;
  confirmOverwrite: (existing: string[]) => Promise<boolean>;
}) => Promise<{ succeeded: number; skipped: number; failed: number }>;

function loadGenerateRagCorpusWithFakes(): GenerateRagCorpusFn {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (id: string, parent: { filename?: string } | undefined, isMain: boolean) {
    if (id === 'vscode') {
      return fakeVsCode;
    }
    if (parent?.filename?.endsWith(path.join('rag', 'ragCorpusGenerator.js'))) {
      if (id === '../llm/copilotClient') {
        return fakeCopilotClient;
      }
      if (id === '../cache/fileCache') {
        return fakeFileCache;
      }
    }
    // eslint-disable-next-line prefer-rest-params
    return originalLoad.apply(this, arguments);
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../src/rag/ragCorpusGenerator');
    return mod.generateRagCorpus as GenerateRagCorpusFn;
  } finally {
    Module._load = originalLoad;
  }
}

const generateRagCorpus = loadGenerateRagCorpusWithFakes();

function acceptingRecipeResponse(id: string, title: string, ownerClassName: string): string {
  return (
    '---\n' +
    `id: ${id}\n` +
    `title: ${title}\n` +
    'tags: [db]\n' +
    'automationMode: [api]\n' +
    'language: [java]\n' +
    '---\n\n' +
    'API: public Row find(int id):\n' +
    '```java\n' +
    // A02: the receiver must match the real owner class (exact name, its
    // instance-variable rendering, or a local binding) for source
    // grounding to accept this — the exact class name itself always
    // qualifies, so this stays valid regardless of which fixture file
    // (PostgresHelper/ExternalHelper) is generating.
    `${ownerClassName}.find(id);\n` +
    '```\n'
  );
}

function frontmatterOf(text: string): Record<string, unknown> {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, 'written recipe must have a frontmatter block');
  return yaml.load(match![1]) as Record<string, unknown>;
}

test('A07: a source file confirmed present in an open workspace folder is stamped sourceMapped: true', async () => {
  resetState(async (fileName) => acceptingRecipeResponse('postgres-helper-find', `Find by id (${fileName})`, 'PostgresHelper'));
  const token = { isCancellationRequested: false };
  const result = await generateRagCorpus({
    modelId: 'fake-model',
    files: [{ fileName: 'PostgresHelper.java', content: MAPPED_SOURCE_CONTENT }],
    workspaceRoot: fakeUri('/fake-workspace'),
    cancellationToken: token,
    onProgress: (p) => state.progress.push(p),
    confirmOverwrite: async () => true
  });

  assert.equal(result.succeeded, 1, JSON.stringify(state.progress));
  assert.equal(state.writes.length, 1);
  const frontmatter = frontmatterOf(state.writes[0].text);
  assert.equal(frontmatter.sourceMapped, true, 'a source confirmed present at generation time must be stamped sourceMapped: true');
});

test('A07: a source file that cannot be found in ANY open workspace folder (a genuinely external upload) is stamped sourceMapped: false, never omitted or true', async () => {
  resetState(async (fileName) => acceptingRecipeResponse('external-helper-find', `Find by id (${fileName})`, 'ExternalHelper'));
  const token = { isCancellationRequested: false };
  const result = await generateRagCorpus({
    modelId: 'fake-model',
    // A file with the SAME shape of content but a name/path that the fake
    // workspace's stat/readFile never recognizes — simulating a real
    // external upload (e.g. a shared framework project never opened here).
    files: [{ fileName: 'ExternalHelper.java', content: 'public class ExternalHelper {\n  public Row find(int id) { return null; }\n}\n' }],
    workspaceRoot: fakeUri('/fake-workspace'),
    cancellationToken: token,
    onProgress: (p) => state.progress.push(p),
    confirmOverwrite: async () => true
  });

  assert.equal(result.succeeded, 1, JSON.stringify(state.progress));
  assert.equal(state.writes.length, 1);
  const frontmatter = frontmatterOf(state.writes[0].text);
  assert.equal(frontmatter.sourceMapped, false, 'a source that could not be confirmed present anywhere must be stamped sourceMapped: false — never left unset (which downstream would treat as the legacy/unknown case) and never true');
});

test('A07: a whole-file (no capability split) generation is ALSO stamped sourceMapped consistently with its per-capability sibling', async () => {
  // A config-shaped file (no capability extraction — capabilitiesForFile()
  // falls back to exactly one whole-file unit) must get the SAME treatment
  // — sourceMapped is a property of the FILE, not of capability-level
  // extraction.
  resetState(async () => '---\nid: config-notes\ntitle: Config notes\ntags: []\nautomationMode: [api]\nlanguage: [java]\n---\n\nSome free-text notes.\n');
  const token = { isCancellationRequested: false };
  const result = await generateRagCorpus({
    modelId: 'fake-model',
    files: [{ fileName: 'notes.config', content: 'arbitrary config content with no extractable capability' }],
    workspaceRoot: fakeUri('/fake-workspace'),
    cancellationToken: token,
    onProgress: (p) => state.progress.push(p),
    confirmOverwrite: async () => true
  });

  assert.equal(result.succeeded, 1, JSON.stringify(state.progress));
  const frontmatter = frontmatterOf(state.writes[0].text);
  assert.equal(frontmatter.sourceMapped, false, 'an unmapped whole-file upload must also be stamped sourceMapped: false');
});
