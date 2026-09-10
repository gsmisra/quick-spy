/**
 * A13 fix — the "is this specific request still the one whose result may
 * actually be committed?" decision, pulled out of agenticModeController.ts
 * as its own pure, zero-`vscode`-import module so it's directly unit
 * tested (matching this codebase's established "pure decision logic
 * extracted and tested, vscode-dependent orchestration reviewed" split —
 * see e.g. rag/ragFreshnessChecker.ts vs. rag/ragFreshnessService.ts).
 *
 * The bug this closes: `generateFeatureFile()`/`generateAutomationCode()`/
 * `generateTestCaseCsv()` each create their own `vscode.CancellationTokenSource`
 * per call and pass its token down into the LangChain chain invocation
 * (`VSCodeCopilotToolCallingModel`) — but NONE of them re-checked whether
 * that SAME request was still current between `chain.invoke()` resolving
 * and actually committing its result (a panel `.finish()`, a CSV file
 * write, an error/status message, a token-count update). Reproduced with a
 * real controller and a deliberately deferred chain response: start
 * generation, call `reset()` (which cancels the in-flight request and
 * clears the panel), then resolve the OLD response — the cleared panel
 * showed the old result again, because nothing had ever checked "is this
 * still the request I should be showing?"
 *
 * Deliberately does NOT rely on the chain's own `invoke()` promise
 * rejecting once cancellation fires — `VSCodeCopilotToolCallingModel`'s own
 * cancellation handling is best-effort, and a response already in flight
 * when `.cancel()` is called can still resolve SUCCESSFULLY afterward. This
 * must be checked EXPLICITLY, every time, immediately before any
 * output/file/UI side effect a generation method is about to commit.
 */

/** The minimal shape this module needs from a `vscode.CancellationTokenSource`
 * — a structural (not nominal) type, so this file itself never needs to
 * import `vscode` at all; the real `vscode.CancellationTokenSource`
 * already satisfies this shape without any adaptation. */
export interface CancellationSourceLike {
  token: { isCancellationRequested: boolean };
}

/** True when `cts` — captured at the START of one generation call — is no
 * longer trustworthy to commit ANY result for:
 *  - `current !== cts`: a NEWER call of the SAME kind superseded it —
 *    either a fresh "Start"/"Regenerate" click (which cancels+disposes the
 *    PREVIOUS source and installs a new one before this one's own
 *    `chain.invoke()` even resolves), or `reset()`/Clear Data (which sets
 *    the field back to `undefined`).
 *  - `cts.token.isCancellationRequested`: cancelled without necessarily
 *    having been REPLACED yet — e.g. `dispose()` (extension/webview
 *    teardown), which cancels every source but leaves the fields still
 *    pointing at them.
 *
 * Either condition alone is sufficient — checked as an OR, not an AND, so
 * a request that was cancelled but (by coincidence, or because nothing
 * else has started yet) is still the "current" one is STILL correctly
 * treated as stale. */
export function isStaleRequest(cts: CancellationSourceLike, current: CancellationSourceLike | undefined): boolean {
  return current !== cts || cts.token.isCancellationRequested;
}
