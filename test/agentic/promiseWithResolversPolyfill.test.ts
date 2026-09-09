import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { installPromiseWithResolversPolyfill } from '../../src/agentic/promiseWithResolversPolyfill';

type WithResolversFn = <T>() => { promise: Promise<T>; resolve: (value: T) => void; reject: (reason?: unknown) => void };

/** This test suite's own Node (running these tests) very likely already
 * has native `Promise.withResolvers` — so every test here explicitly
 * removes it first and restores it afterward, to actually exercise the
 * "genuinely missing" code path the polyfill exists for (Node < 22 /
 * whatever older Node an installed VS Code's extension host bundles),
 * rather than accidentally testing against the native implementation and
 * never touching the polyfill's own logic at all. */
function withoutNativeWithResolvers<T>(fn: () => T): T {
  const promiseCtor = Promise as unknown as { withResolvers?: unknown };
  const original = promiseCtor.withResolvers;
  delete promiseCtor.withResolvers;
  try {
    return fn();
  } finally {
    promiseCtor.withResolvers = original;
  }
}

test('installs a working withResolvers when the native one is missing', () => {
  withoutNativeWithResolvers(() => {
    assert.equal(typeof (Promise as unknown as { withResolvers?: unknown }).withResolvers, 'undefined');
    installPromiseWithResolversPolyfill();
    assert.equal(typeof (Promise as unknown as { withResolvers: unknown }).withResolvers, 'function');
  });
});

test('the installed polyfill resolves the returned promise when resolve() is called', async () => {
  await withoutNativeWithResolvers(async () => {
    installPromiseWithResolversPolyfill();
    const withResolvers = (Promise as unknown as { withResolvers: WithResolversFn }).withResolvers;
    const { promise, resolve } = withResolvers<string>();
    resolve('done');
    assert.equal(await promise, 'done');
  });
});

test('the installed polyfill rejects the returned promise when reject() is called', async () => {
  await withoutNativeWithResolvers(async () => {
    installPromiseWithResolversPolyfill();
    const withResolvers = (Promise as unknown as { withResolvers: WithResolversFn }).withResolvers;
    const { promise, reject } = withResolvers<string>();
    reject(new Error('boom'));
    await assert.rejects(promise, /boom/);
  });
});

test('never overwrites an existing native implementation', () => {
  const promiseCtor = Promise as unknown as { withResolvers?: unknown };
  const sentinel = () => 'sentinel';
  const original = promiseCtor.withResolvers;
  promiseCtor.withResolvers = sentinel;
  try {
    installPromiseWithResolversPolyfill();
    assert.equal(promiseCtor.withResolvers, sentinel);
  } finally {
    promiseCtor.withResolvers = original;
  }
});
