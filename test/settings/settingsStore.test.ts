import { test } from 'node:test';
import * as assert from 'node:assert/strict';

/**
 * Verifies the one-time "ragEnabled default flipped from true to false"
 * migration (settingsStore.ts's `RAG_ENABLED_DEFAULT_MIGRATION_KEY`) — an
 * EXISTING installation's already-persisted `ragEnabled: true` must be
 * forced to `false` exactly once, then never touched again once the
 * migration marker is set, so a user who deliberately re-enables it
 * afterward keeps that choice.
 *
 * Uses the SAME `Module._load` fake-`vscode` technique this codebase
 * already establishes elsewhere (e.g. ragCorpusGenerator's own test
 * files) — settingsStore.ts's only REAL runtime use of the `vscode`
 * namespace is `vscode.EventEmitter` (`vscode.Disposable`/
 * `vscode.ExtensionContext` are types only, erased at compile time), so a
 * minimal fake is enough to load and exercise the real, compiled module.
 */

class FakeEventEmitter<T> {
  private listeners: ((value: T) => void)[] = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  fire(value: T): void {
    this.listeners.forEach((l) => l(value));
  }
  dispose(): void {
    this.listeners = [];
  }
}

const fakeVsCode = { EventEmitter: FakeEventEmitter };

/** A minimal, in-memory `vscode.ExtensionContext`-shaped fake — only
 * `globalState.get`/`.update` are ever touched by settingsStore.ts. */
function fakeContext(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    globalState: {
      get: (key: string) => store.get(key),
      update: async (key: string, value: unknown) => {
        store.set(key, value);
      }
    },
    // Exposed for tests to inspect the underlying store directly.
    __store: store
  };
}

function loadSettingsStoreWithFakeVsCode(): typeof import('../../src/settings/settingsStore') {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Module = require('module');
  const originalLoad = Module._load;
  Module._load = function (id: string, parent: unknown, isMain: boolean) {
    if (id === 'vscode') {
      return fakeVsCode;
    }
    // eslint-disable-next-line prefer-rest-params
    return originalLoad.apply(this, arguments);
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../src/settings/settingsStore');
  } finally {
    Module._load = originalLoad;
  }
}

const { SettingsStore } = loadSettingsStoreWithFakeVsCode();
const MIGRATION_KEY = 'objectSpy.ragEnabledDefaultMigrated.v1';
const STORAGE_KEY = 'objectSpy.settings';

test('a BRAND-NEW install (no stored settings at all) gets ragEnabled: false from the ordinary default', () => {
  const context = fakeContext();
  const store = new SettingsStore(context as never);
  assert.equal(store.get().ragEnabled, false);
});

test('an EXISTING installation whose persisted settings still carry the OLD ragEnabled: true default is migrated to false exactly once', () => {
  const context = fakeContext({ [STORAGE_KEY]: { ragEnabled: true, language: 'java' } });
  const store = new SettingsStore(context as never);
  assert.equal(store.get().ragEnabled, false, 'an existing user\'s stale ragEnabled:true must be forced off by the one-time migration');
  assert.equal(context.__store.get(MIGRATION_KEY), true, 'the migration marker must be set so this never re-fires');
});

test('a user who explicitly RE-ENABLES ragEnabled AFTER the migration has already run keeps that choice on the next load', () => {
  // Simulates: migration already ran once (marker present), and the user
  // has since gone into Settings and checked the box back on — that
  // persisted `true` must NOT be clobbered by a second, redundant
  // migration attempt.
  const context = fakeContext({
    [STORAGE_KEY]: { ragEnabled: true, language: 'java' },
    [MIGRATION_KEY]: true
  });
  const store = new SettingsStore(context as never);
  assert.equal(store.get().ragEnabled, true, 'a deliberate re-enable after migration must be respected, never silently reverted');
});

test('an existing installation that already had ragEnabled: false persisted (no change needed) stays false after migration, and the marker is still set', () => {
  const context = fakeContext({ [STORAGE_KEY]: { ragEnabled: false, language: 'python' } });
  const store = new SettingsStore(context as never);
  assert.equal(store.get().ragEnabled, false);
  assert.equal(context.__store.get(MIGRATION_KEY), true);
});

test('the migration does not disturb any OTHER persisted setting', () => {
  const context = fakeContext({ [STORAGE_KEY]: { ragEnabled: true, language: 'python', languageVersion: '3.11', ragHybridEnabled: true } });
  const store = new SettingsStore(context as never);
  const settings = store.get();
  assert.equal(settings.ragEnabled, false);
  assert.equal(settings.language, 'python');
  assert.equal(settings.languageVersion, '3.11');
  assert.equal(settings.ragHybridEnabled, true, 'an unrelated setting must survive the migration untouched');
});

test('update() after migration persists ragEnabled normally, like any other setting', async () => {
  const context = fakeContext({ [STORAGE_KEY]: { ragEnabled: true } });
  const store = new SettingsStore(context as never);
  assert.equal(store.get().ragEnabled, false); // migrated off
  const updated = await store.update({ ragEnabled: true });
  assert.equal(updated.ragEnabled, true);
  assert.equal(store.get().ragEnabled, true);
});
