import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import * as fs from 'fs';

/**
 * A01: an AUTOMATED regression test proving `capability.signature` — not
 * just `capability.excerpt` — is scrubbed before ever reaching the model
 * (`buildCapabilityPrompt()` in ragCorpusGenerator.ts). Before this fix, a
 * credential-shaped default argument value embedded directly in a
 * signature line (e.g. Python's `def login(password="SYNTHETIC_SECRET"):`)
 * was sent to Copilot completely unscrubbed, even though the byte-
 * identical text — when it ALSO appears inside `capability.excerpt` —
 * was already redacted there. Reproduced and closed via a real, external
 * code review of this session's own work (finding A01).
 *
 * Uses the SAME `Module._load` fake-vscode technique as
 * `ragCorpusGenerator.cancellation.test.ts` (F14) to run the REAL, compiled
 * `generateRagCorpus()` end-to-end and inspect the COMPLETE outgoing
 * prompt text — not just re-assert `scrubSecretsFromRecipe()`'s own
 * already-tested behavior in isolation, which would prove the scrubber
 * works but say nothing about whether `buildCapabilityPrompt()` actually
 * calls it on this specific field. The harness below is a deliberate,
 * small DUPLICATE of that sibling file's own fake-vscode surface (rather
 * than a shared import) — consistent with this codebase's existing
 * per-test-file fixture style (every RAG test file already defines its own
 * local Java/Python fixtures rather than sharing one), and avoids touching
 * an already-passing, already-reviewed test file for an unrelated finding.
 */

interface FakeUri {
  fsPath: string;
  path: string;
  scheme: 'file';
  toString(): string;
}

function fakeUri(p: string): FakeUri {
  return { fsPath: p, path: p, scheme: 'file', toString: () => p };
}

interface FakeState {
  writes: { path: string; text: string }[];
  prompts: string[];
  progress: { fileName: string; status: string; message?: string }[];
  responder: (prompt: string, token: { isCancellationRequested: boolean }) => Promise<string>;
}

const state: FakeState = { writes: [], prompts: [], progress: [], responder: async () => '' };

function resetState(responder: FakeState['responder']): void {
  state.writes = [];
  state.prompts = [];
  state.progress = [];
  state.responder = responder;
}

/** Same minimal surface as `ragCorpusGenerator.cancellation.test.ts`'s own
 * fake — see that file's own doc comment for what's covered and why. */
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
  workspace: {
    fs: {
      createDirectory: async () => {},
      stat: async () => {
        throw new Error('ENOENT (fake): not found');
      },
      readFile: async () => {
        throw new Error('ENOENT (fake): not found');
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
  sendPrompt: async (_modelId: string, prompt: string, onChunk: (chunk: string) => void, token: { isCancellationRequested: boolean }) => {
    state.prompts.push(prompt);
    onChunk(await state.responder(prompt, token));
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

const SECRET_SENTINEL = 'SYNTHETIC_SECRET_DO_NOT_LEAK';

// Mirrors the review's own reproduced example exactly: a credential-shaped
// default argument VALUE embedded directly in the signature line itself,
// not merely somewhere else in the method body.
const AUTH_HELPER_PYTHON = `class AuthHelper:
    def login(self, password="${SECRET_SENTINEL}"):
        return authenticate(password)
`;

function acceptingRecipeResponse(): string {
  return (
    '---\n' +
    'id: auth-helper-login\n' +
    'title: Log in via the shared auth helper\n' +
    'tags: [auth, login]\n' +
    'automationMode: [api]\n' +
    'language: [python]\n' +
    '---\n\n' +
    'API: def login(self, password):\n' +
    '```python\n' +
    'auth_helper.login(password)\n' +
    '```\n'
  );
}

test('A01: the SIGNATURE line is scrubbed before reaching the model, not just the excerpt — the complete outgoing prompt never contains the raw secret', async () => {
  resetState(async () => acceptingRecipeResponse());
  const token = { isCancellationRequested: false };
  await generateRagCorpus({
    modelId: 'fake-model',
    files: [{ fileName: 'auth_helper.py', content: AUTH_HELPER_PYTHON }],
    workspaceRoot: fakeUri('/fake-workspace'),
    cancellationToken: token,
    onProgress: (p) => state.progress.push(p),
    confirmOverwrite: async () => true
  });

  assert.ok(state.prompts.length > 0, 'the model must actually have been called for this test to mean anything');
  for (const prompt of state.prompts) {
    assert.doesNotMatch(prompt, new RegExp(SECRET_SENTINEL), 'the raw secret must never appear anywhere in a prompt sent to the model — including the "### Signature" section');
    assert.match(prompt, /### Signature\n.*<REDACTED>/, 'the signature section must still be present, just with the secret value replaced');
  }
});

test('A01: a signature with NO secret-shaped value is sent completely unchanged (no over-redaction)', async () => {
  resetState(async () => acceptingRecipeResponse());
  const token = { isCancellationRequested: false };
  const plainJava = 'public class Finder {\n  public Row find(int id) {\n    return byId(id);\n  }\n}\n';
  await generateRagCorpus({
    modelId: 'fake-model',
    files: [{ fileName: 'Finder.java', content: plainJava }],
    workspaceRoot: fakeUri('/fake-workspace'),
    cancellationToken: token,
    onProgress: (p) => state.progress.push(p),
    confirmOverwrite: async () => true
  });

  assert.ok(state.prompts.length > 0);
  assert.ok(
    state.prompts.some((p) => p.includes('### Signature\npublic Row find(int id)')),
    'a signature with nothing secret-shaped in it must be sent byte-for-byte unchanged, never altered by the scrubber'
  );
});
