import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'path';
import { EventEmitter } from 'events';

/**
 * A user reported that "Playwright Browser is not launching even after
 * entering the URL and clicking Start. Its going back to Idle state." —
 * reproduced directly: `playwright codegen --channel=chrome` exits almost
 * immediately (`Chromium distribution 'chrome' is not found at
 * C:\...\chrome.exe`) when the selected browser channel isn't actually
 * installed on the machine, and `start()` previously spawned it with
 * `stdio: 'ignore'` — the failure was completely invisible, the status
 * just silently reverted from "running" back to "idle" with zero
 * explanation.
 *
 * Fixed by piping (not ignoring) the child's stderr, and — on a non-zero
 * exit whose stderr matches Playwright's own "is not found at"/"distribution
 * ... is not found" error text — surfacing a clear `vscode.window.showErrorMessage`
 * ("<Chrome|Edge> is not installed on this machine...") and an `'error'`
 * status, instead of silently falling back to `'idle'`. Any OTHER non-zero
 * exit (e.g. the user closing the codegen window manually) still falls back
 * to `'idle'` exactly as before — this is additive, not a behavior change
 * for that case.
 *
 * Technique: fakes BOTH `vscode` (EventEmitter/window.showErrorMessage/
 * createOutputChannel — this codebase's own established Module._load
 * pattern) AND `child_process`'s `spawn`, returning a fully-controlled fake
 * child process (a real Node `EventEmitter` with the handful of methods
 * `codegenManager.ts` actually calls) — `resolveCodegenCliPath()` still
 * resolves the REAL, installed `playwright` package for real (no faking
 * needed there, and doing so would just be extra risk for zero benefit).
 */

class FakeChildProcess extends EventEmitter {
  killed = false;
  readonly stderr = new EventEmitter();
  unref(): void {
    // no-op — nothing this test needs to observe.
  }
  kill(): void {
    this.killed = true;
  }
}

interface FakeVsCode {
  EventEmitter: new () => { event: (cb: (v: unknown) => void) => { dispose(): void }; fire: (v: unknown) => void };
  window: { showErrorMessage: (message: string) => Promise<undefined>; createOutputChannel: () => { appendLine: () => void } };
  Disposable: new () => object;
}

function makeFakeVsCode(): { fakeVsCode: FakeVsCode; shownErrors: string[] } {
  const shownErrors: string[] = [];
  class FakeEventEmitter {
    private listeners: ((v: unknown) => void)[] = [];
    get event() {
      return (cb: (v: unknown) => void) => {
        this.listeners.push(cb);
        return { dispose: () => undefined };
      };
    }
    fire(v: unknown): void {
      this.listeners.forEach((cb) => cb(v));
    }
  }
  const fakeVsCode: FakeVsCode = {
    EventEmitter: FakeEventEmitter,
    window: {
      showErrorMessage: async (message: string) => {
        shownErrors.push(message);
        return undefined;
      },
      createOutputChannel: () => ({ appendLine: () => undefined })
    },
    Disposable: class {}
  };
  return { fakeVsCode, shownErrors };
}

function loadCodegenManager(fakeVsCode: FakeVsCode, fakeSpawn: (...args: unknown[]) => FakeChildProcess): { CodegenManager: new () => Record<string, any> } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (id: string, parent: unknown, isMain: boolean) {
    if (id === 'vscode') {
      return fakeVsCode;
    }
    if (id === 'child_process') {
      return { spawn: fakeSpawn, execFile: () => undefined };
    }
    // eslint-disable-next-line prefer-rest-params
    return originalLoad.apply(this, arguments);
  };
  try {
    // Force a fresh module instance per test (the fake child_process/vscode
    // differ per test) rather than reusing Node's require cache.
    delete require.cache[require.resolve('../../src/browser/codegenManager')];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../../src/browser/codegenManager');
    return { CodegenManager: mod.CodegenManager };
  } finally {
    Module._load = originalLoad;
  }
}

test('a browser channel that is not installed shows a clear "<Browser> is not installed on this machine" alert, not a silent revert to idle', async () => {
  const { fakeVsCode, shownErrors } = makeFakeVsCode();
  let fakeChild!: FakeChildProcess;
  const { CodegenManager } = loadCodegenManager(fakeVsCode, (..._args: unknown[]) => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  });
  const mgr = new CodegenManager();
  const statuses: unknown[] = [];
  mgr.onStatusChange((s: unknown) => statuses.push(s));

  await mgr.start('https://example.com', 'python', 'chrome');
  fakeChild.stderr.emit('data', Buffer.from(`[PlaywrightError: command.parse: Chromium distribution 'chrome' is not found at C:\\fake\\chrome.exe\nRun "npx playwright install chrome"]`));
  fakeChild.emit('exit', 1);

  assert.deepEqual(statuses[statuses.length - 1], {
    state: 'error',
    message: 'Chrome is not installed on this machine — SoftPlay launches the real, already-installed Chrome directly and never downloads a browser of its own. Install Chrome, then try again.'
  });
  assert.equal(shownErrors.length, 1);
  assert.match(shownErrors[0], /Chrome is not installed on this machine/);
});

test('the same failure for the Edge channel names Edge, not Chrome', async () => {
  const { fakeVsCode, shownErrors } = makeFakeVsCode();
  let fakeChild!: FakeChildProcess;
  const { CodegenManager } = loadCodegenManager(fakeVsCode, (..._args: unknown[]) => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  });
  const mgr = new CodegenManager();

  await mgr.start('https://example.com', 'python', 'edge');
  fakeChild.stderr.emit('data', Buffer.from(`Chromium distribution 'msedge' is not found at C:\\fake\\msedge.exe`));
  fakeChild.emit('exit', 1);

  assert.equal(shownErrors.length, 1);
  assert.match(shownErrors[0], /Edge is not installed on this machine/);
  assert.doesNotMatch(shownErrors[0], /Chrome is not installed/);
});

test('a non-zero exit that is NOT the "browser not installed" error still falls back to idle, exactly as before this fix', async () => {
  const { fakeVsCode, shownErrors } = makeFakeVsCode();
  let fakeChild!: FakeChildProcess;
  const { CodegenManager } = loadCodegenManager(fakeVsCode, (..._args: unknown[]) => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  });
  const mgr = new CodegenManager();
  const statuses: unknown[] = [];
  mgr.onStatusChange((s: unknown) => statuses.push(s));

  await mgr.start('https://example.com', 'python', 'chrome');
  fakeChild.stderr.emit('data', Buffer.from('some unrelated crash text'));
  fakeChild.emit('exit', 1);

  assert.deepEqual(statuses[statuses.length - 1], { state: 'idle' });
  assert.equal(shownErrors.length, 0, 'an unrelated failure must not be misreported as "browser not installed"');
});

test('exiting with code 0 (the user closed the codegen window manually) still falls back to idle with no alert', async () => {
  const { fakeVsCode, shownErrors } = makeFakeVsCode();
  let fakeChild!: FakeChildProcess;
  const { CodegenManager } = loadCodegenManager(fakeVsCode, (..._args: unknown[]) => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  });
  const mgr = new CodegenManager();
  const statuses: unknown[] = [];
  mgr.onStatusChange((s: unknown) => statuses.push(s));

  await mgr.start('https://example.com', 'python', 'chrome');
  fakeChild.emit('exit', 0);

  assert.deepEqual(statuses[statuses.length - 1], { state: 'idle' });
  assert.equal(shownErrors.length, 0);
});

test('a manual stop() before the process actually exits suppresses the late exit event entirely — no error alert from an already-superseded child', async () => {
  const { fakeVsCode, shownErrors } = makeFakeVsCode();
  let fakeChild!: FakeChildProcess;
  const { CodegenManager } = loadCodegenManager(fakeVsCode, (..._args: unknown[]) => {
    fakeChild = new FakeChildProcess();
    return fakeChild;
  });
  const mgr = new CodegenManager();

  await mgr.start('https://example.com', 'python', 'chrome');
  await mgr.stop();
  // A late 'exit' from the now-superseded child, even one that LOOKS like
  // the "not installed" error, must be a pure no-op — mirrors the existing
  // "Only react if this is still the child we're tracking" guard, now also
  // protecting the new error-detection branch.
  fakeChild.stderr.emit('data', Buffer.from(`Chromium distribution 'chrome' is not found at C:\\fake\\chrome.exe`));
  fakeChild.emit('exit', 1);

  assert.equal(shownErrors.length, 0);
});
