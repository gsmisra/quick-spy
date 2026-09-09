/**
 * Ponyfill for `Promise.withResolvers()` (ES2024, TC39 stage 4) — pdfjs-dist
 * v6's Node build (pdfIngestion.ts) calls this directly at module-load
 * time and crashes with `TypeError: Promise.withResolvers is not a
 * function` on any JS engine that predates it (V8 needs to be new enough
 * for Node 22+ — anything older, including whatever Node a slightly older
 * installed VS Code bundles into its extension host, doesn't have it).
 * This surfaced for real: the dev machine's Node 24 has it natively (so
 * the bug never showed up there), but a colleague's VS Code install
 * crashed every `.pdf` ingestion outright.
 *
 * Installed once, and ONLY if genuinely missing — never overwrites a
 * native implementation, so this has zero effect on any environment that
 * already has real support (this codebase's own dev machine included).
 * Zero `vscode` import, directly unit-testable.
 */
export function installPromiseWithResolversPolyfill(): void {
  const promiseCtor = Promise as unknown as { withResolvers?: <T>() => PromiseWithResolvers<T> };
  if (typeof promiseCtor.withResolvers === 'function') {
    return;
  }
  promiseCtor.withResolvers = function withResolvers<T>(): PromiseWithResolvers<T> {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

interface PromiseWithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}
